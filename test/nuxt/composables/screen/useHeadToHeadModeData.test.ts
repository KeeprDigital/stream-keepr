import type { EffectScope } from 'vue';
import type { ScreenOutputHeadToHeadMeeting, ScreenOutputHeadToHeadPlayer, ScreenOutputHeadToHeadResponse } from '~~/shared/types/screenOutputReads';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';

const defaultConfig = {
	playerSource: 'featureMatchSlot' as 'featureMatchSlot' | 'players',
	featureMatchId: null as number | null,
	player1Id: null as number | null,
	player2Id: null as number | null,
	showHeader: true,
	headerText: undefined as string | undefined,
};

const mutableConfig = reactive({ ...defaultConfig });
const mockEventId = ref<number | null>(1);
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
type Handler = (message: Record<string, unknown>) => void;
const channelHandlers = new Map<string, Set<Handler>>();
const continuity = createContinuitySignal();
const mockRealtime = reactive({
	connectionState: 'connected',
	tokenError: null as Error | null,
	onChannel: (channel: string, type: string, handler: Handler) => {
		const key = `${channel}|${type}`;
		if (!channelHandlers.has(key))
			channelHandlers.set(key, new Set());
		channelHandlers.get(key)!.add(handler);
		return () => channelHandlers.get(key)!.delete(handler);
	},
	onContinuityLost: continuity.onContinuityLost,
	onceAttached: vi.fn(() => () => {}),
});

/** An Event message, as the Event channel delivers it. */
function deliver(type: string, payload: Record<string, unknown>) {
	for (const handler of channelHandlers.get(`event:1|${type}`) ?? [])
		handler({ eventId: 1, ...payload });
}

mockNuxtImport('$fetch', () => mockFetch);
mockNuxtImport('tryUseRealtime', () => () => mockRealtime);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: ref(false),
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));
const displayEvent = ref<Record<string, unknown> | null>(null);
mockNuxtImport('useEventStore', () => () => reactive({ displayEvent }));

const ALICE = 7;
const BOB = 8;

function side(id: number, name: string): ScreenOutputHeadToHeadPlayer {
	return { id, name, pronouns: null, wins: 3, losses: 1, draws: 0, points: 9, position: 4, deckName: null, deckColors: null };
}

function meeting(overrides: Partial<ScreenOutputHeadToHeadMeeting> = {}): ScreenOutputHeadToHeadMeeting {
	return { matchId: 20, roundId: 31, roundName: 'Round 2', roundNumber: 2, phaseName: 'Swiss', winnerId: ALICE, gameScore: '2-1', ...overrides };
}

function answer(overrides: Partial<ScreenOutputHeadToHeadResponse> = {}): ScreenOutputHeadToHeadResponse {
	return { player1: side(ALICE, 'Alice'), player2: side(BOB, 'Bob'), meetings: [meeting()], ...overrides };
}

const scopes: EffectScope[] = [];

function makeHeadToHeadModeData() {
	const scope = effectScope();
	const result = scope.run(() => useHeadToHeadModeData())!;
	scopes.push(scope);
	return result;
}

describe('useHeadToHeadModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		mockEventId.value = 1;
		displayEvent.value = null;
		mockRealtime.connectionState = 'connected';
		mockRealtime.tokenError = null;
		mockFetch.mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('reads the two Players and their meetings through the Screen', async () => {
		mutableConfig.featureMatchId = 4;
		mockFetch.mockResolvedValue(answer());

		const { player1, player2, meetings, firstMeeting, error } = makeHeadToHeadModeData();
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/head-to-head', expect.anything());
		expect(player1.value?.name).toBe('Alice');
		expect(player2.value?.name).toBe('Bob');
		expect(meetings.value).toHaveLength(1);
		expect(firstMeeting.value).toBe(false);
		expect(error.value).toBeNull();
	});

	it('calls two Players with no earlier meeting a first meeting', async () => {
		mutableConfig.featureMatchId = 4;
		mockFetch.mockResolvedValue(answer({ meetings: [] }));

		const { firstMeeting } = makeHeadToHeadModeData();
		await flushPromises();

		expect(firstMeeting.value).toBe(true);
	});

	it('is no first meeting while a side is empty', async () => {
		mutableConfig.featureMatchId = 4;
		mockFetch.mockResolvedValue(answer({ player2: null, meetings: [] }));

		const { firstMeeting, isEmpty } = makeHeadToHeadModeData();
		await flushPromises();

		expect(firstMeeting.value).toBe(false);
		expect(isEmpty.value).toBe(false);
	});

	it('reads nothing and is empty while the chosen source names no Slot or no Player', async () => {
		mutableConfig.player1Id = ALICE;
		const { isEmpty } = makeHeadToHeadModeData();
		await flushPromises();
		expect(isEmpty.value).toBe(true);

		mutableConfig.playerSource = 'players';
		mutableConfig.featureMatchId = 4;
		mutableConfig.player1Id = null;
		await flushPromises();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(isEmpty.value).toBe(true);
	});

	it('is empty when the Slot seats no Players', async () => {
		mutableConfig.featureMatchId = 4;
		mockFetch.mockResolvedValue(answer({ player1: null, player2: null, meetings: [] }));

		const { isEmpty } = makeHeadToHeadModeData();
		await flushPromises();

		expect(isEmpty.value).toBe(true);
	});

	it('re-reads when the source, the Slot or a picked Player changes', async () => {
		mutableConfig.featureMatchId = 4;
		mockFetch.mockResolvedValue(answer());
		makeHeadToHeadModeData();
		await flushPromises();

		mutableConfig.featureMatchId = 5;
		await flushPromises();
		mutableConfig.playerSource = 'players';
		mutableConfig.player1Id = ALICE;
		await flushPromises();
		mutableConfig.player2Id = BOB;
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledTimes(4);
	});

	describe('formatRecord', () => {
		it('writes wins and losses, leaving out no draws', () => {
			expect(makeHeadToHeadModeData().formatRecord({ wins: 4, losses: 1, draws: 0 })).toBe('4-1');
		});

		it('writes draws when there are some', () => {
			expect(makeHeadToHeadModeData().formatRecord({ wins: 3, losses: 1, draws: 1 })).toBe('3-1-1');
		});

		it('follows the Event\'s record display settings', () => {
			displayEvent.value = { displayRecordSeparator: '/', displayHideZeroDraws: false };
			expect(makeHeadToHeadModeData().formatRecord({ wins: 2, losses: 0, draws: 0 })).toBe('2/0/0');
		});

		it('writes nothing for a Player with no record yet', () => {
			expect(makeHeadToHeadModeData().formatRecord({ wins: null, losses: null, draws: null })).toBeNull();
		});
	});

	describe('headerText', () => {
		it('prefers the configured header', () => {
			mutableConfig.headerText = 'Feature Match Preview';
			expect(makeHeadToHeadModeData().headerText.value).toBe('Feature Match Preview');
		});

		it('falls back to a generic header', () => {
			expect(makeHeadToHeadModeData().headerText.value).toBe('Head to Head');
		});
	});

	describe('freshness', () => {
		async function showingSlot() {
			mutableConfig.featureMatchId = 4;
			mockFetch.mockResolvedValue(answer());
			const data = makeHeadToHeadModeData();
			await flushPromises();
			mockFetch.mockClear();
			return data;
		}

		it('follows its Slot to the Players of its next Feature Match Assignment', async () => {
			const { player1 } = await showingSlot();
			mockFetch.mockResolvedValue(answer({ player1: side(9, 'Carol'), meetings: [] }));

			deliver('featureMatch:updated', { featureMatch: { id: 4, matchId: 99, player1Id: 9, player2Id: BOB } });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(player1.value?.name).toBe('Carol');
		});

		it('ignores other Slots, and its Slot once Players are picked directly', async () => {
			await showingSlot();

			deliver('featureMatch:updated', { featureMatch: { id: 5, player1Id: 1, player2Id: 2 } });
			deliver('melee:featureMatchesSynced', { slotIds: [5] });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			mutableConfig.playerSource = 'players';
			mutableConfig.player1Id = ALICE;
			mutableConfig.player2Id = BOB;
			await flushPromises();
			mockFetch.mockClear();

			deliver('featureMatch:updated', { featureMatch: { id: 4, player1Id: 1, player2Id: 2 } });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('follows its Slot being synced from Melee or deleted', async () => {
			await showingSlot();

			deliver('melee:featureMatchesSynced', { slotIds: [4] });
			await flushPromises();
			deliver('featureMatch:deleted', { featureMatchId: 4 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('follows a result reported between the two, and no other Match', async () => {
			await showingSlot();

			deliver('match:updated', { match: { id: 30, roundId: 32, player1Id: ALICE, player2Id: 9 } });
			deliver('match:created', { match: { id: 31, roundId: 32, player1Id: 9, player2Id: 10 } });
			deliver('match:deleted', { matchId: 31 });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('match:updated', { match: { id: 21, roundId: 32, player1Id: BOB, player2Id: ALICE } });
			await flushPromises();
			deliver('match:created', { match: { id: 22, roundId: 33, player1Id: ALICE, player2Id: BOB } });
			await flushPromises();
			deliver('match:deleted', { matchId: 20 });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(3);
		});

		it('follows a change to either Player, and to no one else', async () => {
			await showingSlot();

			deliver('player:updated', { player: { id: 5 } });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('player:updated', { player: { id: BOB } });
			await flushPromises();
			deliver('player:deleted', { playerId: ALICE });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('follows new Round Standings and Archetype changes', async () => {
			await showingSlot();

			deliver('melee:roundSynced', { roundId: 40, matchCount: 8, created: 0, updated: 8, staleDeleted: 0 });
			await flushPromises();
			deliver('archetype:updated', { archetype: { id: 3, name: 'Boros Energy' } });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('shows a result missed while disconnected once its channel is attached again', async () => {
			const { meetings } = await showingSlot();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			mockFetch.mockResolvedValue(answer({ meetings: [meeting(), meeting({ matchId: 21, roundName: 'Round 5' })] }));
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(meetings.value).toHaveLength(2);
		});
	});
});
