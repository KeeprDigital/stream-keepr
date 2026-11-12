import type { ScreenResponse } from '~~/shared/api';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { $fetch, fetch, operatorSessionCookie } from './client';
import { createCommandHarness } from './featureMatchSessionHelpers';
import { anotherBrowser } from './identities';

interface LeaseState {
	artifact: { kind: string; id: string };
	role: 'holder' | 'observer';
	writable: boolean;
	heldByAnotherSession: boolean;
	holderName?: string;
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

/**
 * The lease itself, which no part of depends on Ably: this file runs against a
 * keyless server. The one claim that is a realtime publish (a Screen command under
 * a lease) is `graphicsAuthoringLease.realtime.test.ts`.
 */
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
			body: options.body === undefined
				? undefined
				: JSON.stringify(options.body),
		});
		const text = await response.text();
		return {
			status: response.status,
			data: text
				? JSON.parse(text)
				: null,
		};
	}

	async function askForLease(
		cookie: string,
		body: { takeover?: boolean; heartbeatIntervalMs?: number } = {},
	): Promise<{ status: number; data: LeaseResponse }> {
		return await request(leasePath(), { method: 'POST', body, cookie }) as { status: number; data: LeaseResponse };
	}

	async function patchStack(cookie: string, graphics: BroadcastGraphicConfig[]) {
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
	 * The clock that stamps every lease deadline. A deadline is the server's number,
	 * so it is judged against the server's clock and never this process's.
	 */
	async function serverNow(): Promise<number> {
		const { serverTime } = await $fetch<{ serverTime: number }>('/api/time');
		return serverTime;
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
	 * the test named — and a name-filtered rerun is the first thing anyone tries when
	 * something looks flaky (#311).
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
		const asked = await serverNow();

		const acquired = await askForLease(browserA);

		expect(acquired.status).toBe(200);
		expect(acquired.data.outcome).toBe('grant');
		expect(acquired.data.lease.artifact).toEqual({
			kind: 'screen-edit-workspace',
			id: String(screenId),
		});
		expect(acquired.data.lease.role).toBe('holder');
		expect(acquired.data.lease.writable).toBe(true);
		expect(acquired.data.lease.expiresAt).toBeGreaterThan(asked);
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

	/**
	 * The takeover surface is shown a person, never a session id (#398,
	 * ADR-0010).
	 *
	 * Both browsers here are the same operator, so the name that comes back is
	 * their own — which is the honest answer and the useful one: what an observer
	 * has to decide is whether to go and ask a colleague or close their own second
	 * window, and only a name can tell them.
	 */
	it('names the person holding it, rather than handing over a session id', async () => {
		await askForLease(browserA);

		const asked = await askForLease(browserB);

		expect(asked.data.lease.holderName).toBe('Integration Operator');
		expect(JSON.stringify(asked.data.lease)).not.toContain(browserA.split('=')[1]!.slice(0, 12));
	});

	it('accepts the holder\'s authoring write and refuses an observer\'s', async () => {
		await askForLease(browserA);

		const accepted = await patchStack(browserA, [
			graphic('holder-stack'),
		]);
		expect(accepted.status).toBe(200);

		const refused = await patchStack(browserB, [
			graphic('observer-stack'),
		]);
		expect(refused.status).toBe(409);

		expect((await authoredStack()).map(entry => entry.id)).toEqual(['holder-stack']);
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

	/**
	 * The generic Screen write reaches the same artifact by another door (#607).
	 *
	 * The write below carries the Screen's current `stateVersion`, so a refusal is
	 * the lease's and not a stale-version conflict — which is exactly how the
	 * generic route used to let an observer through.
	 */
	async function currentScreen(): Promise<ScreenResponse> {
		return await $fetch<ScreenResponse>(`/api/events/${eventId}/screens/${screenId}`);
	}

	async function patchScreen(cookie: string, body: Record<string, unknown>) {
		return await request(`/api/events/${eventId}/screens/${screenId}`, {
			method: 'PATCH',
			body: { stateVersion: (await currentScreen()).stateVersion, ...body },
			cookie,
		});
	}

	it('refuses an observer\'s stack edit through the generic Screen write', async () => {
		await askForLease(browserA);
		await patchStack(browserA, [
			graphic('holder-stack'),
		]);
		const before = await currentScreen();

		const refused = await patchScreen(browserB, {
			modeConfigs: {
				...before.modeConfigs,
				'broadcast-graphics': {
					graphics: [
						graphic('observer-stack'),
					],
				},
			},
		});

		expect(refused.status).toBe(409);
		expect((await authoredStack()).map(entry => entry.id)).toEqual(['holder-stack']);
		expect((await currentScreen()).stateVersion).toBe(before.stateVersion);
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

		expect((await patchStack(browserA, [
			graphic('stale-author'),
		])).status).toBe(409);
		expect((await patchStack(browserB, [
			graphic('new-author'),
		])).status).toBe(200);
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
});
