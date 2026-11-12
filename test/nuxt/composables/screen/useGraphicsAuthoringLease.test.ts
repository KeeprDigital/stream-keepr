import type { EffectScope, Ref } from 'vue';
import type { GraphicsAuthoringLeaseReading } from '~~/shared/modules/graphics-authoring-lease';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS } from '~~/shared/modules/graphics-authoring-lease';
import { deferred } from '~~/test/helpers/deferred';
import { requestsMadeTo } from '~~/test/helpers/ingestionTransferRequests';
import { lastCallTo } from '~~/test/helpers/lastCallTo';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const SCREEN_A = '/api/events/1/screens/7/graphics-authoring-lease';
const SCREEN_B = '/api/events/1/screens/8/graphics-authoring-lease';
const HEARTBEAT_MS = GRAPHICS_AUTHORING_LEASE_DEFAULT_HEARTBEAT_MS;
/** The deadline the server gives a holder heartbeating at the default cadence. */
const LEASE_TTL_MS = 3 * HEARTBEAT_MS;

type LeaseAnswer = { lease: GraphicsAuthoringLeaseReading } | Promise<{ lease: GraphicsAuthoringLeaseReading }>;

function reading(overrides: Partial<GraphicsAuthoringLeaseReading>): { lease: GraphicsAuthoringLeaseReading } {
	return {
		lease: {
			artifact: { kind: 'screen-edit-workspace', id: '7' },
			role: 'holder',
			writable: true,
			heldByAnotherSession: false,
			expiresAt: Date.now() + LEASE_TTL_MS,
			heldSince: Date.now(),
			heartbeatIntervalMs: HEARTBEAT_MS,
			...overrides,
		},
	};
}

/** The server grants or renews the asking Session's lease. */
const held = () => reading({});
/** The server answers that another Session holds a live lease. */
function observing(holderName?: string) {
	return reading({
		role: 'observer',
		writable: false,
		heldByAnotherSession: true,
		holderName,
	});
}
const unreachable = () => Promise.reject(new Error('Failed to fetch'));

/** How the lease endpoint answers each ask from here on; a release always succeeds. */
function leaseAnswers(answer: () => LeaseAnswer) {
	mockFetch.mockImplementation(async (_path: string, options?: { method?: string }) =>
		options?.method === 'DELETE'
			? undefined
			: await answer());
}

/** The next asks are answered in turn with these; later ones as set by `leaseAnswers`. */
function nextLeaseAnswers(...answers: Array<() => LeaseAnswer>) {
	for (const answer of answers)
		mockFetch.mockImplementationOnce(async () => await answer());
}

const requests = () => requestsMadeTo(mockFetch);
const releasesOf = (endpoint: string) => requests().filter(request => request === `DELETE ${endpoint}`).length;
const asksOf = (endpoint: string) => requests().filter(request => request === `POST ${endpoint}`).length;

/** Lets answered requests land without moving the clock. */
const settle = () => vi.advanceTimersByTimeAsync(0);

const scopes: EffectScope[] = [];

/** One editor opening an artifact: the real composable in a scope the test can close. */
function openEditor(options: Parameters<typeof useGraphicsAuthoringLease>[0] = { endpoint: SCREEN_A }) {
	const scope = effectScope();
	scopes.push(scope);
	const lease = scope.run(() => useGraphicsAuthoringLease(options))!;
	return {
		lease,
		close: () => scope.stop(),
	};
}

function seen(lease: ReturnType<typeof useGraphicsAuthoringLease>) {
	return {
		status: lease.status.value,
		writable: lease.writable.value,
		heldByAnotherSession: lease.heldByAnotherSession.value,
		canTakeOver: lease.canTakeOver.value,
		holderName: lease.holderName.value,
	};
}

describe('useGraphicsAuthoringLease', () => {
	beforeEach(() => {
		vi.useFakeTimers({ now: 1_000_000 });
		leaseAnswers(held);
	});

	afterEach(() => {
		for (const scope of scopes.splice(0))
			scope.stop();
		vi.useRealTimers();
	});

	describe('what the editor may do', () => {
		// Fail closed: nothing is writable until the server has said so.
		it('is not writable while its first ask is unanswered', async () => {
			const answer = deferred<{ lease: GraphicsAuthoringLeaseReading }>();
			nextLeaseAnswers(() => answer.promise);

			const { lease } = openEditor();

			expect(seen(lease)).toMatchObject({ status: 'pending', writable: false, canTakeOver: false });

			answer.resolve(held());
			await settle();

			expect(seen(lease)).toMatchObject({ status: 'ready', writable: true });
		});

		it.each([
			{
				answer: 'a granted lease',
				respond: held,
				expected: {
					status: 'ready',
					writable: true,
					heldByAnotherSession: false,
					canTakeOver: false,
					holderName: null,
				},
			},
			{
				answer: 'another Session holding it',
				respond: () => observing('Avery'),
				expected: {
					status: 'ready',
					writable: false,
					heldByAnotherSession: true,
					canTakeOver: true,
					holderName: 'Avery',
				},
			},
			{
				answer: 'an unnamed Session holding it',
				respond: () => observing(),
				expected: {
					status: 'ready',
					writable: false,
					heldByAnotherSession: true,
					canTakeOver: true,
					holderName: null,
				},
			},
			{
				answer: 'no answer at all',
				respond: unreachable,
				expected: {
					status: 'error',
					writable: false,
					heldByAnotherSession: false,
					canTakeOver: false,
					holderName: null,
				},
			},
		])('reads $answer as writable=$expected.writable', async ({ respond, expected }) => {
			leaseAnswers(respond);

			const { lease } = openEditor();
			await settle();

			expect(seen(lease)).toEqual(expected);
		});

		it('asks nothing while the artifact is not open for authoring', async () => {
			const { lease } = openEditor({ endpoint: SCREEN_A, enabled: false });
			await settle();
			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

			expect(requests()).toEqual([]);
			expect(seen(lease)).toMatchObject({ status: 'idle', writable: false });
		});
	});

	describe('asking again', () => {
		it('takes over from the holder on the author\'s instruction', async () => {
			leaseAnswers(() => observing('Avery'));
			const { lease } = openEditor();
			await settle();

			leaseAnswers(held);
			await lease.takeOver();

			expect(lastCallTo(mockFetch, SCREEN_A)[1]).toMatchObject({
				method: 'POST',
				body: { takeover: true },
			});
			expect(seen(lease)).toMatchObject({ writable: true, heldByAnotherSession: false, canTakeOver: false });
		});

		// One loop is the holder's heartbeat and the observer's chance of promotion.
		it('re-asks on the heartbeat cadence, promoting an observer once the holder is gone', async () => {
			leaseAnswers(() => observing('Avery'));
			const { lease } = openEditor();
			await settle();
			expect(asksOf(SCREEN_A)).toBe(1);

			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
			expect(asksOf(SCREEN_A)).toBe(2);
			expect(lastCallTo(mockFetch, SCREEN_A)[1]).toMatchObject({
				body: { heartbeatIntervalMs: HEARTBEAT_MS },
			});
			expect(lease.writable.value).toBe(false);

			leaseAnswers(held);
			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

			expect(asksOf(SCREEN_A)).toBe(3);
			expect(seen(lease)).toMatchObject({ writable: true, heldByAnotherSession: false, holderName: null });
		});

		it('demotes a holder whose heartbeat finds another Session took over', async () => {
			const { lease } = openEditor();
			await settle();

			leaseAnswers(() => observing('Avery'));
			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

			expect(seen(lease)).toMatchObject({ writable: false, heldByAnotherSession: true, holderName: 'Avery' });
		});

		it('re-asks as soon as a hidden tab is shown again', async () => {
			openEditor();
			await settle();

			document.dispatchEvent(new Event('visibilitychange'));
			await settle();

			expect(asksOf(SCREEN_A)).toBe(2);
		});
	});

	describe('a heartbeat that gets no answer', () => {
		// The server holds the lease until its deadline whatever one request does,
		// so a holder stays writable until then and fails closed only after.
		it.each([
			{
				elapsed: 'its first missed heartbeat',
				ms: HEARTBEAT_MS,
				expected: { status: 'ready', writable: true },
			},
			{
				elapsed: 'just short of its deadline',
				ms: LEASE_TTL_MS - 1_000,
				expected: { status: 'ready', writable: true },
			},
			{
				elapsed: 'its deadline',
				ms: LEASE_TTL_MS,
				expected: { status: 'error', writable: false },
			},
		])('leaves a holder writable=$expected.writable at $elapsed', async ({ ms, expected }) => {
			const { lease } = openEditor();
			await settle();

			leaseAnswers(unreachable);
			await vi.advanceTimersByTimeAsync(ms);

			expect(seen(lease)).toMatchObject(expected);
		});

		it('asks again sooner than the next heartbeat, and stops once answered', async () => {
			const { lease } = openEditor();
			await settle();
			nextLeaseAnswers(unreachable);

			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
			expect(asksOf(SCREEN_A)).toBe(2);

			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS / 2);
			expect(asksOf(SCREEN_A)).toBe(3);
			expect(seen(lease)).toMatchObject({ status: 'ready', writable: true });
		});

		// The deadline is counted from when the answered ask was sent, on this
		// browser's clock, so a server clock ahead of or behind it changes nothing.
		it.each([
			{ serverClock: 'an hour ahead', skewMs: 3_600_000 },
			{ serverClock: 'an hour behind', skewMs: -3_600_000 },
		])('keeps the same deadline with the server clock $serverClock', async ({ skewMs }) => {
			leaseAnswers(() => reading({ expiresAt: Date.now() + skewMs + LEASE_TTL_MS }));
			const { lease } = openEditor();
			await settle();
			leaseAnswers(unreachable);

			await vi.advanceTimersByTimeAsync(LEASE_TTL_MS - 1_000);
			expect(lease.writable.value).toBe(true);

			await vi.advanceTimersByTimeAsync(1_000);
			expect(lease.writable.value).toBe(false);
		});

		it('fails an observer closed at once, having no lease of its own to keep', async () => {
			leaseAnswers(() => observing('Avery'));
			const { lease } = openEditor();
			await settle();

			leaseAnswers(unreachable);
			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

			expect(seen(lease)).toMatchObject({ status: 'error', writable: false, heldByAnotherSession: false });
		});
	});

	// What an editor drops its unsaved edits on: the lease taken by another
	// Session, or lapsed; never a close of its own, whose pending save still lands.
	describe('losing the lease', () => {
		it.each([
			{
				way: 'another Session taking it over',
				then: async () => {
					leaseAnswers(() => observing('Avery'));
					await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);
				},
				lost: true,
			},
			{
				way: 'its deadline passing unanswered',
				then: async () => {
					leaseAnswers(unreachable);
					await vi.advanceTimersByTimeAsync(LEASE_TTL_MS);
				},
				lost: true,
			},
			{
				way: 'a heartbeat going unanswered short of its deadline',
				then: async () => {
					leaseAnswers(unreachable);
					await vi.advanceTimersByTimeAsync(LEASE_TTL_MS - 1_000);
				},
				lost: false,
			},
			{
				way: 'the artifact closing for authoring',
				then: async (open: Ref<boolean>) => {
					open.value = false;
					await settle();
				},
				lost: false,
			},
		])('counts $way as lost=$lost', async ({ then, lost }) => {
			const open = ref(true);
			const { lease } = openEditor({ endpoint: SCREEN_A, enabled: open });
			await settle();
			expect(lease.lost.value).toBe(false);

			await then(open);

			expect(lease.lost.value).toBe(lost);
		});
	});

	describe('releasing', () => {
		it.each([
			{
				leaving: 'the editor closes',
				leave: (editor: ReturnType<typeof openEditor>) => editor.close(),
			},
			{
				leaving: 'the artifact stops being open for authoring',
				leave: (_editor: ReturnType<typeof openEditor>, open: Ref<boolean>) => {
					open.value = false;
				},
			},
		])('releases a held lease when $leaving, and stops heartbeating', async ({ leave }) => {
			const open = ref(true);
			const editor = openEditor({ endpoint: SCREEN_A, enabled: open });
			await settle();

			leave(editor, open);
			await settle();
			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

			expect(requests()).toEqual([`POST ${SCREEN_A}`, `DELETE ${SCREEN_A}`]);
			expect(seen(editor.lease)).toMatchObject({ status: 'idle', writable: false });
		});

		it('releases the artifact it left and asks for the one it opened', async () => {
			const endpoint = ref(SCREEN_A);
			const { lease } = openEditor({ endpoint });
			await settle();

			endpoint.value = SCREEN_B;
			await settle();

			expect(requests()).toEqual([`POST ${SCREEN_A}`, `DELETE ${SCREEN_A}`, `POST ${SCREEN_B}`]);
			expect(lease.writable.value).toBe(true);
		});

		it('releases nothing it only observed', async () => {
			leaseAnswers(() => observing('Avery'));
			const pagehide = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
			const editor = openEditor();
			await settle();

			window.dispatchEvent(new Event('pagehide'));
			editor.close();
			await settle();

			expect(releasesOf(SCREEN_A)).toBe(0);
			expect(pagehide).not.toHaveBeenCalled();
		});

		// `keepalive` is what lets the release outlive the closing page.
		it('releases a held lease as the page is hidden for good', async () => {
			const pagehide = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response());
			openEditor();
			await settle();

			window.dispatchEvent(new Event('pagehide'));

			expect(pagehide.mock.calls).toEqual([
				[
					SCREEN_A,
					{ method: 'DELETE', keepalive: true },
				],
			]);
		});
	});

	describe('answers that arrive late', () => {
		it.each([
			{
				late: 'a grant',
				settleLate: (answer: ReturnType<typeof deferred<{ lease: GraphicsAuthoringLeaseReading }>>) => answer.resolve(held()),
			},
			{
				late: 'a failure',
				settleLate: (answer: ReturnType<typeof deferred<{ lease: GraphicsAuthoringLeaseReading }>>) => answer.reject(new Error('Failed to fetch')),
			},
		])('ignores $late for an artifact the editor has since left', async ({ settleLate }) => {
			const late = deferred<{ lease: GraphicsAuthoringLeaseReading }>();
			nextLeaseAnswers(() => late.promise);
			leaseAnswers(() => observing('Avery'));
			const endpoint = ref(SCREEN_A);
			const { lease } = openEditor({ endpoint });

			endpoint.value = SCREEN_B;
			await settle();
			settleLate(late);
			await settle();

			expect(seen(lease)).toMatchObject({ status: 'ready', writable: false, holderName: 'Avery' });
		});

		// A grant nobody is waiting for would hold the artifact against the next
		// author until its deadline, so it is handed straight back.
		it.each([
			{
				leaving: 'the editor closed',
				leave: (editor: ReturnType<typeof openEditor>) => editor.close(),
			},
			{
				leaving: 'the artifact stopped being open for authoring',
				leave: (_editor: ReturnType<typeof openEditor>, open: Ref<boolean>) => {
					open.value = false;
				},
			},
			{
				leaving: 'the editor opened another artifact',
				leave: (_editor: ReturnType<typeof openEditor>, _open: Ref<boolean>, endpoint: Ref<string>) => {
					endpoint.value = SCREEN_B;
				},
			},
		])('releases a lease granted after $leaving', async ({ leave }) => {
			const late = deferred<{ lease: GraphicsAuthoringLeaseReading }>();
			nextLeaseAnswers(() => late.promise);
			leaseAnswers(() => observing('Avery'));
			const open = ref(true);
			const endpoint = ref(SCREEN_A);
			const editor = openEditor({ endpoint, enabled: open });

			leave(editor, open, endpoint);
			await settle();
			late.resolve(held());
			await settle();

			expect(releasesOf(SCREEN_A)).toBe(1);
			expect(editor.lease.writable.value).toBe(false);
		});

		it('releases nothing when the late answer was only an observation', async () => {
			const late = deferred<{ lease: GraphicsAuthoringLeaseReading }>();
			nextLeaseAnswers(() => late.promise);
			const editor = openEditor();

			editor.close();
			late.resolve(observing('Avery'));
			await settle();

			expect(releasesOf(SCREEN_A)).toBe(0);
		});

		it('keeps a takeover\'s answer over an older ask answered after it', async () => {
			leaseAnswers(() => observing('Avery'));
			const { lease } = openEditor();
			await settle();
			const heartbeat = deferred<{ lease: GraphicsAuthoringLeaseReading }>();
			nextLeaseAnswers(() => heartbeat.promise, held);
			await vi.advanceTimersByTimeAsync(HEARTBEAT_MS);

			await lease.takeOver();
			heartbeat.resolve(observing('Avery'));
			await settle();

			expect(seen(lease)).toMatchObject({ writable: true, heldByAnotherSession: false });
		});

		// A re-ask sent behind a takeover could be answered first and say "observer";
		// the takeover's own answer is the newer truth, so nothing is asked over it.
		it('lets a takeover in flight answer before asking again', async () => {
			leaseAnswers(() => observing('Avery'));
			const { lease } = openEditor();
			await settle();
			const takeover = deferred<{ lease: GraphicsAuthoringLeaseReading }>();
			nextLeaseAnswers(() => takeover.promise);

			const takingOver = lease.takeOver();
			document.dispatchEvent(new Event('visibilitychange'));
			await settle();
			takeover.resolve(held());
			await takingOver;

			expect(asksOf(SCREEN_A)).toBe(2);
			expect(seen(lease)).toMatchObject({ writable: true, heldByAnotherSession: false });
		});
	});
});
