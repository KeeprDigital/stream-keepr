import type { ScreenResponse } from '~~/shared/api';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { $fetch, fetch } from '@nuxt/test-utils/e2e';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCommandHarness } from './featureMatchSessionHelpers';
import { createGraphicsAuthorSessionCookie } from './graphicsAuthorSession';
import { integrationRealtimeConfigured } from './helpers';
import { diagnoseRealtimePublishFailure } from './realtimeDiagnosis';

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

	async function patchCanvas(cookie: string | undefined, height: number) {
		return await request(`/api/events/${eventId}/screens/${screenId}/screen-config`, {
			method: 'PATCH',
			body: { height },
			cookie,
		});
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
		const asked = await askForLease(authorB);

		expect(asked.status).toBe(200);
		expect(asked.data.outcome).toBe('observe');
		expect(asked.data.lease.role).toBe('observer');
		expect(asked.data.lease.writable).toBe(false);
		expect(asked.data.lease.heldByAnotherSession).toBe(true);
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
		const before = await askForLease(authorA);
		await new Promise(resolve => setTimeout(resolve, 20));
		const renewed = await askForLease(authorA);

		expect(renewed.data.outcome).toBe('renew');
		expect(renewed.data.lease.role).toBe('holder');
		expect(renewed.data.lease.expiresAt!).toBeGreaterThan(before.data.lease.expiresAt!);
		expect(renewed.data.lease.heldSince).toBe(before.data.lease.heldSince);
	});

	// Split from the command-session case below because a Screen command *is* a
	// realtime publish — the route has nothing else to do — so it can only answer 200
	// where a real Ably key is. The lease claim itself does not depend on Ably, and
	// the half that does not is left unguarded so it still runs without the secret.
	it.skipIf(!integrationRealtimeConfigured)('never restricts a Screen command while the Edit workspace is leased', async () => {
		// The two assertions below carry a diagnosis rather than a bare status compare,
		// because this is the one place in the suite where a configured-but-rejected
		// Ably key surfaces: the route's only work is the publish, so Ably's 404 becomes
		// the route's 404 and reads as a lease regression. See `realtimeDiagnosis`.

		// The lease holder is session A; every live action below is another operator.
		const command = await request(`/api/events/${eventId}/screens/${screenId}/command`, {
			method: 'POST',
			body: { command: 'refresh' },
			cookie: authorB,
		});
		expect(command.status, diagnoseRealtimePublishFailure(command.status, command.data)).toBe(200);

		const anonymousCommand = await request(`/api/events/${eventId}/screens/${screenId}/command`, {
			method: 'POST',
			body: { command: 'refresh' },
		});
		expect(anonymousCommand.status, diagnoseRealtimePublishFailure(anonymousCommand.status, anonymousCommand.data)).toBe(200);
	});

	it('never restricts a live command session while the Edit workspace is leased', async () => {
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

	it('refuses an observer\'s resize of the leased Screen canvas', async () => {
		expect((await askForLease(authorA)).data.lease.writable).toBe(true);

		expect((await patchCanvas(authorA, 1080)).status).toBe(200);
		expect((await patchCanvas(authorB, 720)).status).toBe(409);

		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		expect(screen.screenConfig?.height).toBe(1080);
	});

	it('leaves every other Screen configuration field open while the canvas is leased', async () => {
		// The lease covers the canvas, not the route. A generic Screen field is not
		// part of any graphics Edit workspace and stays open to every operator.
		expect((await request(`/api/events/${eventId}/screens/${screenId}/screen-config`, {
			method: 'PATCH',
			body: { paddingX: 12 },
			cookie: authorB,
		})).status).toBe(200);
	});

	it('never leases the canvas of a Screen that is not in Broadcast Graphics mode', async () => {
		const other = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Idle Screen', slug: 'lease-idle-screen', currentMode: 'idle' },
		});

		const resized = await request(`/api/events/${eventId}/screens/${other.id}/screen-config`, {
			method: 'PATCH',
			body: { height: 480 },
			cookie: authorB,
		});

		expect(resized.status).toBe(200);
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
	});

	it('frees an artifact whose holding session disappeared without releasing it', async () => {
		const acquired = await askForLease(authorA, { heartbeatIntervalMs: 1_000 });
		expect(acquired.data.outcome).toBe('grant');
		expect(acquired.data.lease.expiresAt! - Date.now()).toBeLessThanOrEqual(3_000);

		// Session A is gone: it never heartbeats again and never releases.
		expect((await askForLease(authorB)).data.outcome).toBe('observe');

		await new Promise(resolve => setTimeout(resolve, 3_200));

		const recovered = await askForLease(authorB);
		expect(recovered.data.outcome).toBe('grant');
		expect(recovered.data.lease.role).toBe('holder');
		expect(recovered.data.lease.heldByAnotherSession).toBe(false);

		await request(leasePath(), { method: 'DELETE', cookie: authorB });
	});

	it('leaves an unleased Edit workspace writable by anyone', async () => {
		expect((await patchStack(undefined, [graphic('unleased')])).status).toBe(200);
		expect((await authoredStack()).map(entry => entry.id)).toEqual(['unleased']);
		expect((await patchCanvas(undefined, 900)).status).toBe(200);
	});
});
