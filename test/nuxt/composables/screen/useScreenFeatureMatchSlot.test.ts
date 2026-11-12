import type { EffectScope } from 'vue';
import type { ScreenOutputFeatureMatchResponse } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';
import { createMockFeatureMatch, createMockFeatureMatchState } from '~~/test/helpers/fixtures';
import { createFakeEventChannel } from '~~/test/helpers/realtime-mock';
import { createSession } from '~~/test/nuxt/helpers/featureMatchStateHarness';
import { screenContextOf } from '~~/test/nuxt/helpers/screenContext';
import { useScreenFeatureMatchSlot } from '~/composables/screen/useScreenFeatureMatchSlot';

/**
 * The Feature Match Slot a Feature Match Controls or Feature Match Overlay
 * Screen shows, on the real Slot and Session stores: only the network and the
 * realtime transport are stand-ins.
 */

const EVENT_ID = 7;
const SCREEN_ID = 42;

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const realtime = createFakeEventChannel();
mockNuxtImport('tryUseRealtime', () => () => realtime.transport);

const slotPath = (slotId: number) => `/api/screen-output/events/${EVENT_ID}/screens/${SCREEN_ID}/feature-match-slots/${slotId}`;

/** What the server answers for each Slot, read through the Screen. */
const served = new Map<number, ScreenOutputFeatureMatchResponse>();

/**
 * A Slot read's answer: the Slot following Match 300 in `round`, with its
 * Session, `50x` for Slot `x`, or none where the read predates its first (#658).
 */
function slotRead(slotId: number, { session = 500 + slotId as number | null, round = 'Round 3' } = {}) {
	return {
		slot: createMockFeatureMatch({
			id: slotId,
			eventId: EVENT_ID,
			matchId: 300,
			activeSessionId: session,
			activeSession: session === null
				? null
				: createSession(createMockFeatureMatchState(), { id: session, eventId: EVENT_ID, slotId }),
		} as never),
		match: { id: 300, roundId: 20 },
		round: { id: 20, name: round, phaseId: 5 },
		phase: { id: 5, name: 'Swiss' },
	} as unknown as ScreenOutputFeatureMatchResponse;
}

/** Every request made, a write named by its method. */
function requests(): string[] {
	return mockFetch.mock.calls.map(([path, options]) => options?.method
		? `${options.method} ${path}`
		: String(path));
}

const scopes: EffectScope[] = [];

/** A rendering showing `slotId`, keeping the name of the Round its Slot's Match is in. */
function showing(slotId: number | null, { mode = 'feature-match-overlay', live = false }: { mode?: 'feature-match' | 'feature-match-overlay'; live?: boolean } = {}) {
	const selected = ref(slotId);
	const scope = effectScope();
	scopes.push(scope);
	const shown = scope.run(() => useScreenFeatureMatchSlot<string>(
		screenContextOf({
			screen: ref({ id: SCREEN_ID }),
			eventId: computed(() => EVENT_ID),
			followsScreenChannel: ref(live),
		}),
		{
			mode,
			config: () => ({
				...getDefaultConfigForMode(mode),
				featureMatchId: selected.value,
			}) as never,
			slotId: () => selected.value,
			keep: read => read.round?.name ?? 'no Round',
			initialData: 'nothing kept',
			errorMessage: 'Failed to read the Slot',
		},
	))!;
	return { ...shown, selected, scope };
}

describe('useScreenFeatureMatchSlot', () => {
	beforeEach(() => {
		useFeatureMatchStore().$reset();
		useFeatureMatchStateStore().$reset();
		realtime.reset();
		served.clear();
		mockFetch.mockReset();
		mockFetch.mockImplementation(async (path: string) => {
			const slotId = Number(new RegExp(`^${slotPath(0).slice(0, -1)}(\\d+)$`).exec(path)?.[1]);
			return served.get(slotId) ?? null;
		});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('reads the Slot it shows through its Screen, and holds it with its Session', async () => {
		served.set(11, slotRead(11));

		const { slot, state, data, answered } = showing(11);
		await flushPromises();

		expect(requests()).toEqual([
			slotPath(11),
		]);
		expect(slot.value).toMatchObject({
			id: 11,
			activeSession: { id: 511 },
		});
		expect(state.value).toEqual(served.get(11)!.slot.activeSession!.currentState);
		expect(data.value).toBe('Round 3');
		expect(answered.value).toBe(true);
	});

	it('follows its mode to the Slot it selects next, and to none', async () => {
		served.set(11, slotRead(11));
		served.set(12, slotRead(12, { round: 'Round 4' }));
		const { slot, state, data, selected } = showing(11);
		await flushPromises();

		selected.value = 12;
		await flushPromises();
		expect(requests()).toEqual([
			slotPath(11),
			slotPath(12),
		]);
		expect(slot.value?.id).toBe(12);
		expect(data.value).toBe('Round 4');

		selected.value = null;
		await flushPromises();
		expect(requests()).toHaveLength(2);
		expect({ slot: slot.value, state: state.value, data: data.value }).toEqual({
			slot: null,
			state: null,
			data: 'nothing kept',
		});
	});

	it('shows what a re-read answers once its Slot is promoted to its next Match', async () => {
		served.set(11, slotRead(11));
		const { slot, data } = showing(11);
		await flushPromises();
		served.set(11, slotRead(11, { session: 512, round: 'Round 4' }));

		realtime.deliver('featureMatch:updated', {
			featureMatch: { id: 11 },
		}, EVENT_ID);
		await flushPromises();

		expect(slot.value?.activeSession?.id).toBe(512);
		expect(data.value).toBe('Round 4');
	});

	// Its Session's own messages reach the Live State Follower whole, so only
	// the other kinds its mode declares ask for a read.
	it.each([
		{
			mode: 'feature-match-overlay',
			causes: ['featureMatchSlot'],
			reads: 2,
		},
		{
			mode: 'feature-match-overlay',
			causes: ['featureMatchSession'],
			reads: 1,
		},
		{
			mode: 'feature-match-overlay',
			causes: ['round'],
			reads: 2,
		},
		{
			mode: 'feature-match',
			causes: ['round'],
			reads: 1,
		},
	] as const)('a live $mode Screen told of $causes has read its Slot $reads times', async ({ mode, causes, reads }) => {
		served.set(11, slotRead(11));
		showing(11, { mode, live: true });
		await flushPromises();

		realtime.deliverToScreen(SCREEN_ID, 'output:modeDataChanged', { screenId: SCREEN_ID, causes }, EVENT_ID);
		await flushPromises();

		expect(requests()).toHaveLength(reads);
	});

	// A read from before a promotion or clearing this client has since heard of
	// is left behind whole (ADR-0026): here, one predating the Slot's Session.
	it.each([
		{
			read: 'the Slot it shows, read again',
			slotId: 11,
			kept: 'Round 3',
			session: 511,
		},
		{
			read: 'the Slot it moves to',
			slotId: 12,
			kept: 'nothing kept',
			session: null,
		},
	])('an overtaken read of $read leaves "$kept" shown', async ({ slotId, kept, session }) => {
		served.set(11, slotRead(11));
		const { slot, data, selected } = showing(11);
		await flushPromises();
		useFeatureMatchStateStore().offerSlotSession(slotRead(12).slot);
		served.set(11, slotRead(11, { session: null, round: 'Round 2' }));
		served.set(12, slotRead(12, { session: null, round: 'Round 2' }));

		if (slotId === 11)
			realtime.reattach(EVENT_ID);
		else
			selected.value = slotId;
		await flushPromises();

		expect(requests()).toEqual([
			slotPath(11),
			slotPath(slotId),
		]);
		expect(data.value).toBe(kept);
		expect(slot.value?.activeSession?.id ?? null).toBe(session);
	});

	it('shows the Slot with the Session followed for it, not the one its read carried (ADR-0058)', async () => {
		served.set(11, slotRead(11));
		const { slot } = showing(11);
		await flushPromises();
		const read = slot.value!.activeSession!;

		// The followed Session moves on, as `SwapPlayers` moves it; the Slot held stays as read.
		useFeatureMatchStateStore().offerSlotSession({
			id: 11,
			activeSession: { ...read, sequence: read.sequence + 1 },
		});

		expect(slot.value?.activeSession?.sequence).toBe(read.sequence + 1);
		expect(useFeatureMatchStore().featureMatches[0]?.activeSession?.sequence).toBe(read.sequence);
	});

	// A rendering never starts live state by reading it (#604).
	it('answers the store\'s Session loads through its Screen for as long as it lives', async () => {
		served.set(11, slotRead(11));
		const { scope } = showing(11);
		await flushPromises();
		const sessions = useFeatureMatchStateStore();

		mockFetch.mockClear();
		await sessions.loadState(EVENT_ID, 11);
		expect(requests()).toEqual([
			slotPath(11),
		]);

		scope.stop();
		mockFetch.mockClear();
		await sessions.loadState(EVENT_ID, 11);
		expect(requests()).not.toEqual([]);
		expect(requests().filter(request => request.startsWith('/api/screen-output/'))).toEqual([]);
	});
});
