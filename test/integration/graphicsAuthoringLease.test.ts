import type { ScreenResponse } from '~~/shared/api';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { createCommandHarness } from './featureMatchSessionHelpers';
import { integrationRealtimeConfigured } from './helpers';
import { anotherBrowser } from './identities';
import { diagnoseRealtimePublishFailure, SCREEN_COMMAND_ROUTE_REFUSALS } from './realtimeDiagnosis';

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

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * How long past a lease deadline to wait before expecting the artifact free, and
 * how many times to ask again if it is not.
 *
 * A full second rather than the two hundred milliseconds this suite used to
 * allow. The margin is not covering clock skew — the wait below is derived from
 * the server's own clock — but the scheduling delay between the deadline passing
 * and the next request being served, which on a loaded machine running several
 * worktrees is not small. The poll is what makes the margin a starting point
 * rather than a bet: asking to observe a live lease does not extend it, so a
 * repeat ask is free.
 */
const LEASE_LAPSE_MARGIN_MS = 1_000;
const LEASE_LAPSE_ATTEMPTS = 5;

describe('graphics Authoring Leases', () => {
	let eventId: number;
	let screenId: number;
	/**
	 * Two browsers, deliberately belonging to the **same** operator (#398,
	 * ADR-0010).
	 *
	 * A lease guards concurrent editors, and one person signed in from two browsers
	 * is two editors — so `holderSessionId` carries a Better Auth session id rather
	 * than a userId. Proving that with two different *people* would prove something
	 * weaker and would pass just as well against a lease held per user, which is
	 * the shape that lets one operator silently overwrite their own composition.
	 */
	let browserA: string;
	let browserB: string;

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

	function releaseLease(cookie: string) {
		return request(leasePath(), { method: 'DELETE', cookie });
	}

	/**
	 * Wait out a lease deadline, measured against the clock that stamped it.
	 *
	 * `expiresAt` is the server's number and `/api/time` reads the same clock, so
	 * the wait is derived rather than guessed — this suite used to sleep a
	 * hard-coded 3.2 seconds against a 3-second deadline, which is a bet on a wall
	 * clock the test process does not own. The same reference the Broadcast
	 * Graphics playout suites already synchronise against.
	 */
	async function serverNow(): Promise<number> {
		const { serverTime } = await $fetch<{ serverTime: number }>('/api/time');
		return serverTime;
	}

	async function askOnceLeaseHasLapsed(cookie: string, expiresAt: number) {
		const remaining = expiresAt - await serverNow();
		if (remaining > 0)
			await sleep(remaining + LEASE_LAPSE_MARGIN_MS);

		let asked = await askForLease(cookie);
		for (let attempt = 1; asked.data.outcome === 'observe' && attempt <= LEASE_LAPSE_ATTEMPTS; attempt++) {
			await sleep(LEASE_LAPSE_MARGIN_MS);
			asked = await askForLease(cookie);
		}
		return asked;
	}

	beforeAll(async () => {
		browserA = await operatorSessionCookie();
		browserB = await anotherBrowser();
		expect(browserA).not.toBe(browserB);

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

	/**
	 * Every test starts from an unleased artifact and takes whatever lease it needs.
	 *
	 * This suite used to be a script: the grant in the first test was the premise of
	 * the third, the takeover in the eleventh was the premise of the twelfth, and so
	 * on. A name-filtered rerun then failed for reasons that had nothing to do with
	 * the test named — and a name-filtered rerun is precisely what this repo's own
	 * parallel-rounds procedure prescribes when something looks flaky (#311).
	 *
	 * A release only deletes the asking session's own row, so asking both to release
	 * clears the artifact whichever of them was holding it.
	 */
	beforeEach(async () => {
		await releaseLease(browserA);
		await releaseLease(browserB);
	});

	afterAll(async () => {
		try {
			await $fetch(`/api/events/${eventId}`, { method: 'DELETE' });
		}
		catch {}
	});

	it('grants one session the exclusive lease on a Screen graphics Edit workspace', async () => {
		const acquired = await askForLease(browserA);

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

	/*
	 * A lease asked for with no session at all used to be refused here. Since #398
	 * that refusal is the API boundary's, composed around every `/api/**` route
	 * before any handler runs, and it is proved in `apiBoundary.test.ts` against a
	 * genuinely anonymous client — which this suite's client is not. Asserting it
	 * from here would have to send the request a different way to test a middleware
	 * this file is not about.
	 */

	it('leaves a second session observing the same Edit workspace read-only', async () => {
		await askForLease(browserA);

		const asked = await askForLease(browserB);

		expect(asked.status).toBe(200);
		expect(asked.data.outcome).toBe('observe');
		expect(asked.data.lease.role).toBe('observer');
		expect(asked.data.lease.writable).toBe(false);
		expect(asked.data.lease.heldByAnotherSession).toBe(true);
	});

	it('accepts the holder\'s authoring write and refuses an observer\'s', async () => {
		await askForLease(browserA);

		const accepted = await patchStack(browserA, [graphic('holder-stack')]);
		expect(accepted.status).toBe(200);

		const refused = await patchStack(browserB, [graphic('observer-stack')]);
		expect(refused.status).toBe(409);

		expect((await authoredStack()).map(entry => entry.id)).toEqual(['holder-stack']);
	});

	it('lets an observer read every accepted authoring change', async () => {
		await askForLease(browserA);
		await patchStack(browserA, [graphic('holder-stack'), graphic('second-graphic')]);

		const screen = await request(`/api/events/${eventId}/screens/${screenId}`, { cookie: browserB });

		expect(screen.status).toBe(200);
		expect(
			(screen.data.modeConfigs['broadcast-graphics'].graphics as BroadcastGraphicConfig[])
				.map(entry => entry.id),
		).toEqual(['holder-stack', 'second-graphic']);
	});

	it('renews the deadline for the session already holding the lease', async () => {
		const before = await askForLease(browserA);
		await sleep(20);
		const renewed = await askForLease(browserA);

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
		// Ably key surfaces: the route's only work is the publish, so its answer is
		// whatever the publish did. Since #264 that is a 502 the server names itself
		// rather than Ably's 404 worn as the route's own; either way a bare status
		// compare here reads as a lease regression. See `realtimeDiagnosis`.

		// The lease holder is session A; every live action below is another operator.
		await askForLease(browserA);

		const command = await request(`/api/events/${eventId}/screens/${screenId}/command`, {
			method: 'POST',
			body: { command: 'refresh' },
			cookie: browserB,
		});
		expect(command.status, diagnoseRealtimePublishFailure(command.status, command.data, SCREEN_COMMAND_ROUTE_REFUSALS)).toBe(200);

		const anonymousCommand = await request(`/api/events/${eventId}/screens/${screenId}/command`, {
			method: 'POST',
			body: { command: 'refresh' },
		});
		expect(anonymousCommand.status, diagnoseRealtimePublishFailure(anonymousCommand.status, anonymousCommand.data, SCREEN_COMMAND_ROUTE_REFUSALS)).toBe(200);
	});

	it('never restricts a live command session while the Edit workspace is leased', async () => {
		// Multi-operator live operation keeps running under its own field-scoped
		// conflict rules rather than under the lease.
		await askForLease(browserA);

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
		expect((await askForLease(browserA)).data.lease.writable).toBe(true);

		expect((await patchCanvas(browserA, 1080)).status).toBe(200);
		expect((await patchCanvas(browserB, 720)).status).toBe(409);

		const screen = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
		expect(screen.screenConfig?.height).toBe(1080);
	});

	it('leaves every other Screen configuration field open while the canvas is leased', async () => {
		// The lease covers the canvas, not the route. A generic Screen field is not
		// part of any graphics Edit workspace and stays open to every operator.
		await askForLease(browserA);

		expect((await request(`/api/events/${eventId}/screens/${screenId}/screen-config`, {
			method: 'PATCH',
			body: { paddingX: 12 },
			cookie: browserB,
		})).status).toBe(200);
	});

	it('never leases the canvas of a Screen that is not in Broadcast Graphics mode', async () => {
		await askForLease(browserA);
		const other = await $fetch<ScreenResponse>(`/api/events/${eventId}/screens`, {
			method: 'POST',
			body: { name: 'Idle Screen', slug: 'lease-idle-screen', currentMode: 'idle' },
		});

		const resized = await request(`/api/events/${eventId}/screens/${other.id}/screen-config`, {
			method: 'PATCH',
			body: { height: 480 },
			cookie: browserB,
		});

		expect(resized.status).toBe(200);
	});

	it('hands the artifact over on an explicit takeover and demotes the previous holder', async () => {
		await askForLease(browserA);

		const takenOver = await askForLease(browserB, { takeover: true });

		expect(takenOver.data.outcome).toBe('takeover');
		expect(takenOver.data.lease.role).toBe('holder');
		expect(takenOver.data.lease.writable).toBe(true);

		// The displaced author learns of it on its next heartbeat.
		const displaced = await askForLease(browserA);
		expect(displaced.data.outcome).toBe('observe');
		expect(displaced.data.lease.writable).toBe(false);

		expect((await patchStack(browserA, [graphic('stale-author')])).status).toBe(409);
		expect((await patchStack(browserB, [graphic('new-author')])).status).toBe(200);
	});

	it('ignores a release from a session that does not hold the lease', async () => {
		await askForLease(browserB);

		const released = await releaseLease(browserA);

		expect(released.status).toBe(200);
		expect(released.data.lease.heldByAnotherSession).toBe(true);
		expect(released.data.lease.writable).toBe(false);
	});

	it('frees the artifact when its holder releases the lease', async () => {
		await askForLease(browserB);

		const released = await releaseLease(browserB);

		expect(released.status).toBe(200);
		expect(released.data.lease.writable).toBe(true);
		expect(released.data.lease.heldByAnotherSession).toBe(false);
		expect(released.data.lease.expiresAt).toBeNull();
	});

	it('frees an artifact whose holding session disappeared without releasing it', async () => {
		const acquired = await askForLease(browserA, { heartbeatIntervalMs: 1_000 });
		expect(acquired.data.outcome).toBe('grant');
		expect(acquired.data.lease.expiresAt! - Date.now()).toBeLessThanOrEqual(3_000);

		// Session A is gone: it never heartbeats again and never releases.
		expect((await askForLease(browserB)).data.outcome).toBe('observe');

		const recovered = await askOnceLeaseHasLapsed(browserB, acquired.data.lease.expiresAt!);
		expect(recovered.data.outcome).toBe('grant');
		expect(recovered.data.lease.role).toBe('holder');
		expect(recovered.data.lease.heldByAnotherSession).toBe(false);

		await releaseLease(browserB);
	});

	it('leaves an unleased Edit workspace writable by anyone', async () => {
		expect((await patchStack(undefined, [graphic('unleased')])).status).toBe(200);
		expect((await authoredStack()).map(entry => entry.id)).toEqual(['unleased']);
		expect((await patchCanvas(undefined, 900)).status).toBe(200);
	});
});
