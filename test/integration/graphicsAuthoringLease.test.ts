import type { ScreenResponse } from '~~/shared/api';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCommandHarness } from './featureMatchSessionHelpers';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';

interface LeaseState {
	artifact: { kind: string; id: string };
	role: 'holder' | 'observer';
	writable: boolean;
	heldByAnotherSession: boolean;
	expiresAt: number | null;
	heldSince: number | null;
	heartbeatIntervalMs: number;
}

interface LeaseResponse {
	lease: LeaseState;
	outcome?: 'grant' | 'renew' | 'takeover' | 'observe';
}

function graphic(id: string): BroadcastGraphicConfig {
	return { id, name: id, items: [] };
}

describe('graphics Authoring Leases', () => {
	let eventId: number;
	let screenId: number;
	let authorA: string;
	let authorB: string;

	function leasePath() {
		return `/api/events/${eventId}/screens/${screenId}/graphics-authoring-lease`;
	}

	async function request(
		path: string,
		options: { method?: string; body?: unknown; cookie?: string } = {},
	): Promise<{ status: number; data: any }> {
		const headers: Record<string, string> = {};
		if (options.cookie)
			headers.cookie = options.cookie;
		if (options.body !== undefined)
			headers['content-type'] = 'application/json';

		const response = await fetch(path, {
			method: options.method ?? 'GET',
			headers,
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
		});
		const text = await response.text();
		return { status: response.status, data: text ? JSON.parse(text) : null };
	}

	async function askForLease(
		cookie: string | undefined,
		body: { takeover?: boolean; heartbeatIntervalMs?: number } = {},
	): Promise<{ status: number; data: LeaseResponse }> {
		return await request(leasePath(), { method: 'POST', body, cookie }) as { status: number; data: LeaseResponse };
	}

	async function readLease(cookie?: string): Promise<{ status: number; data: LeaseResponse }> {
		return await request(leasePath(), { cookie }) as { status: number; data: LeaseResponse };
	}

	async function patchStack(cookie: string | undefined, graphics: BroadcastGraphicConfig[]) {
		return await request(`/api/events/${eventId}/screens/${screenId}/config/broadcast-graphics`, {
			method: 'PATCH',
			body: { graphics },
			cookie,
		});
	}

	async function authoredStack(): Promise<BroadcastGraphicConfig[]> {
		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		return (screen.modeConfigs?.['broadcast-graphics']?.graphics ?? []) as BroadcastGraphicConfig[];
	}

	beforeAll(async () => {
		authorA = await createGraphicsAuthorSessionCookie();
		authorB = await createGraphicsAuthorSessionCookie();
		expect(authorA).not.toBe(authorB);

		const event = await $fetch('/api/events', {
			method: 'POST',
			body: {
				name: 'Graphics Authoring Lease Event',
				game: 'mtg',
				featureMatchOrientation: 'horizontal',
			},
		});
		eventId = event.id;

		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: {
				name: 'Lease Graphics Screen',
				slug: 'lease-graphics-screen',
				currentMode: 'broadcast-graphics',
			},
		});
		screenId = screen.id;
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('grants one session the exclusive lease on a Screen graphics Edit workspace', async () => {
		const acquired = await askForLease(authorA);

		expect(acquired.status).toBe(200);
		expect(acquired.data.outcome).toBe('grant');
		expect(acquired.data.lease.artifact).toEqual({
			kind: 'screen-edit-workspace',
			id: String(screenId),
		});
		expect(acquired.data.lease.role).toBe('holder');
		expect(acquired.data.lease.writable).toBe(true);
		expect(acquired.data.lease.expiresAt).toBeGreaterThan(Date.now());
	});

	it('refuses a lease to a client without a graphics author session', async () => {
		const anonymous = await askForLease(undefined);

		expect(anonymous.status).toBe(401);
	});

	it('leaves a second session observing the same Edit workspace read-only', async () => {
		const observed = await readLease(authorB);

		expect(observed.data.lease.role).toBe('observer');
		expect(observed.data.lease.writable).toBe(false);
		expect(observed.data.lease.heldByAnotherSession).toBe(true);

		const asked = await askForLease(authorB);

		expect(asked.status).toBe(200);
		expect(asked.data.outcome).toBe('observe');
		expect(asked.data.lease.writable).toBe(false);
	});

	it('accepts the holder\'s authoring write and refuses an observer\'s', async () => {
		const accepted = await patchStack(authorA, [graphic('holder-stack')]);
		expect(accepted.status).toBe(200);

		const refused = await patchStack(authorB, [graphic('observer-stack')]);
		expect(refused.status).toBe(409);

		expect((await authoredStack()).map(entry => entry.id)).toEqual(['holder-stack']);
	});

	it('lets an observer read every accepted authoring change', async () => {
		await patchStack(authorA, [graphic('holder-stack'), graphic('second-graphic')]);

		const screen = await request(`/api/events/${eventId}/screens/${screenId}`, { cookie: authorB });

		expect(screen.status).toBe(200);
		expect(
			(screen.data.modeConfigs['broadcast-graphics'].graphics as BroadcastGraphicConfig[])
				.map(entry => entry.id),
		).toEqual(['holder-stack', 'second-graphic']);
	});

	it('renews the deadline for the session already holding the lease', async () => {
		const before = await readLease(authorA);
		await new Promise(resolve => setTimeout(resolve, 20));
		const renewed = await askForLease(authorA);

		expect(renewed.data.outcome).toBe('renew');
		expect(renewed.data.lease.role).toBe('holder');
		expect(renewed.data.lease.expiresAt!).toBeGreaterThan(before.data.lease.expiresAt!);
		expect(renewed.data.lease.heldSince).toBe(before.data.lease.heldSince);
	});

	it('never restricts live operation while the Edit workspace is leased', async () => {
		// The lease holder is session A; every live action below is another operator.
		const command = await request(`/api/events/${eventId}/screens/${screenId}/command`, {
			method: 'POST',
			body: { command: 'refresh' },
			cookie: authorB,
		});
		expect(command.status).toBe(200);

		const anonymousCommand = await request(`/api/events/${eventId}/screens/${screenId}/command`, {
			method: 'POST',
			body: { command: 'refresh' },
		});
		expect(anonymousCommand.status).toBe(200);

		// Multi-operator live operation keeps running under its own field-scoped
		// conflict rules rather than under the lease.
		const harness = await createCommandHarness(eventId);
		const live = await harness.send({
			commandId: 'lease:live-operation:1',
			type: 'SetLife',
			payload: { player: 'player1', lifeTotal: 17 },
			baseSequence: harness.session().sequence,
		});
		expect(live.currentState.player1.lifeTotal).toBe(17);
	});

	it('hands the artifact over on an explicit takeover and demotes the previous holder', async () => {
		const takenOver = await askForLease(authorB, { takeover: true });

		expect(takenOver.data.outcome).toBe('takeover');
		expect(takenOver.data.lease.role).toBe('holder');
		expect(takenOver.data.lease.writable).toBe(true);

		// The displaced author learns of it on its next heartbeat.
		const displaced = await askForLease(authorA);
		expect(displaced.data.outcome).toBe('observe');
		expect(displaced.data.lease.writable).toBe(false);

		expect((await patchStack(authorA, [graphic('stale-author')])).status).toBe(409);
		expect((await patchStack(authorB, [graphic('new-author')])).status).toBe(200);
	});

	it('ignores a release from a session that does not hold the lease', async () => {
		const released = await request(leasePath(), { method: 'DELETE', cookie: authorA });

		expect(released.status).toBe(200);
		expect(released.data.lease.heldByAnotherSession).toBe(true);
		expect(released.data.lease.writable).toBe(false);
	});

	it('frees the artifact when its holder releases the lease', async () => {
		const released = await request(leasePath(), { method: 'DELETE', cookie: authorB });

		expect(released.status).toBe(200);
		expect(released.data.lease.writable).toBe(true);
		expect(released.data.lease.heldByAnotherSession).toBe(false);
		expect(released.data.lease.expiresAt).toBeNull();

		expect((await readLease(authorA)).data.lease.writable).toBe(true);
	});

	it('frees an artifact whose holding session disappeared without releasing it', async () => {
		const acquired = await askForLease(authorA, { heartbeatIntervalMs: 1_000 });
		expect(acquired.data.outcome).toBe('grant');
		expect(acquired.data.lease.expiresAt! - Date.now()).toBeLessThanOrEqual(3_000);

		// Session A is gone: it never heartbeats again and never releases.
		expect((await readLease(authorB)).data.lease.writable).toBe(false);

		await new Promise(resolve => setTimeout(resolve, 3_200));

		const recovered = await readLease(authorB);
		expect(recovered.data.lease.writable).toBe(true);
		expect(recovered.data.lease.heldByAnotherSession).toBe(false);

		const reacquired = await askForLease(authorB);
		expect(reacquired.data.outcome).toBe('grant');
		expect(reacquired.data.lease.role).toBe('holder');

		await request(leasePath(), { method: 'DELETE', cookie: authorB });
	});

	it('leaves an unleased Edit workspace writable', async () => {
		expect((await readLease()).data.lease.writable).toBe(true);
		expect((await patchStack(undefined, [graphic('unleased')])).status).toBe(200);
		expect((await authoredStack()).map(entry => entry.id)).toEqual(['unleased']);
	});
});
