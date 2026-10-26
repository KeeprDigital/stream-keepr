import type { EffectScope } from 'vue';
import type { PlayerMatchHistoryEntry } from '~/composables/screen/usePlayerHistoryModeData';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';

const defaultConfig = {
	playerId: null as number | null,
	columns: [
		{ key: 'round', visible: true },
		{ key: 'opponent', visible: true },
		{ key: 'table', visible: true },
		{ key: 'outcome', visible: true },
	],
	showHeader: true,
	headerText: '',
	rowsPerPage: 8,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	currentPage: 1,
	rotationAnchor: undefined as number | undefined,
};

const mutableConfig = reactive({ ...defaultConfig });
const mockEventId = ref<number | null>(1);
const mockInteractive = ref(false);
const mockScreenStore = {
	updateModeConfig: vi.fn(),
};
const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
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
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: mockInteractive,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

function historyEntry(overrides: Partial<PlayerMatchHistoryEntry> = {}): PlayerMatchHistoryEntry {
	return {
		id: 1,
		roundId: 31,
		roundName: 'Round 1',
		roundNumber: 1,
		phaseName: 'Swiss',
		tableNumber: 12,
		opponentId: 2,
		opponentName: 'Nadia Rivers',
		opponentDeckName: 'Grixis',
		opponentDeckColors: 'UBR',
		outcome: 'win',
		playerGameWins: 2,
		opponentGameWins: 1,
		gameDraws: 0,
		hasResult: true,
		resultString: '2-1',
		...overrides,
	};
}

const mockPlayer = {
	id: 7,
	name: 'Nadia Rivers',
	wins: 12,
	losses: 2,
	draws: 1,
	position: 3,
};

const scopes: EffectScope[] = [];

function makePlayerHistoryModeData() {
	const scope = effectScope();
	const result = scope.run(() => usePlayerHistoryModeData())!;
	scopes.push(scope);
	return result;
}

describe('usePlayerHistoryModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig, {
			columns: defaultConfig.columns.map(column => ({ ...column })),
		});
		mockEventId.value = 1;
		mockInteractive.value = false;
		mockRealtime.connectionState = 'connected';
		mockRealtime.tokenError = null;
		mockFetch.mockReset();
		mockScreenStore.updateModeConfig.mockReset();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	it('reads the configured player\'s match history through the Screen', async () => {
		mutableConfig.playerId = 7;
		mockFetch.mockResolvedValue({
			player: mockPlayer,
			history: [
				historyEntry(),
			],
		});

		const { player, pageData, isEmpty, error } = makePlayerHistoryModeData();
		await flushPromises();

		expect(mockFetch).toHaveBeenCalledWith('/api/screen-output/events/1/screens/1/player-history', expect.anything());
		expect(player.value).toEqual(mockPlayer);
		expect(pageData.value).toHaveLength(1);
		expect(pageData.value[0]!.opponentName).toBe('Nadia Rivers');
		expect(isEmpty.value).toBe(false);
		expect(error.value).toBeNull();
	});

	it('does not fetch without a selected player', async () => {
		const { isEmpty, emptyMessage, player } = makePlayerHistoryModeData();
		await flushPromises();

		expect(mockFetch).not.toHaveBeenCalled();
		expect(player.value).toBeNull();
		expect(isEmpty.value).toBe(true);
		expect(emptyMessage.value).toBe('Select a player to show match history.');
	});

	it('does not fetch without an event', async () => {
		mockEventId.value = null;
		mutableConfig.playerId = 7;

		makePlayerHistoryModeData();
		await flushPromises();

		expect(mockFetch).not.toHaveBeenCalled();
	});

	it('re-reads when the selected player changes', async () => {
		mutableConfig.playerId = 7;
		mockFetch.mockResolvedValue({
			player: mockPlayer,
			history: [
				historyEntry(),
			],
		});

		makePlayerHistoryModeData();
		await flushPromises();

		mutableConfig.playerId = 9;
		await flushPromises();

		// The server derives the Player from the saved configuration, so a change
		// is a second read of the same Screen resource.
		expect(mockFetch).toHaveBeenCalledTimes(2);
		expect(mockFetch).toHaveBeenLastCalledWith('/api/screen-output/events/1/screens/1/player-history', expect.anything());
	});

	it('is not empty while the first load is in flight', async () => {
		mutableConfig.playerId = 7;
		let resolveFetch!: (value: unknown) => void;
		mockFetch.mockReturnValue(new Promise((resolve) => {
			resolveFetch = resolve;
		}));

		const { loading, isEmpty, emptyMessage } = makePlayerHistoryModeData();
		await nextTick();

		expect(loading.value).toBe(true);
		expect(isEmpty.value).toBe(false);

		resolveFetch({ player: mockPlayer, history: [] });
		await flushPromises();

		expect(loading.value).toBe(false);
		expect(isEmpty.value).toBe(true);
		expect(emptyMessage.value).toBe('No matches found for this player.');
	});

	describe('headerText', () => {
		it('prefers the configured header', async () => {
			mutableConfig.playerId = 7;
			mutableConfig.headerText = 'Feature Player';
			mockFetch.mockResolvedValue({
				player: mockPlayer,
				history: [
					historyEntry(),
				],
			});

			const { headerText } = makePlayerHistoryModeData();
			await flushPromises();

			expect(headerText.value).toBe('Feature Player');
		});

		it('names the loaded player when no header is configured', async () => {
			mutableConfig.playerId = 7;
			mockFetch.mockResolvedValue({
				player: mockPlayer,
				history: [
					historyEntry(),
				],
			});

			const { headerText } = makePlayerHistoryModeData();
			await flushPromises();

			expect(headerText.value).toBe('Nadia Rivers Match History');
		});

		it('falls back to a generic header before a player loads', () => {
			const { headerText } = makePlayerHistoryModeData();

			expect(headerText.value).toBe('Player Match History');
		});
	});

	describe('formatOutcome', () => {
		it.each([
			[
				'bye',
				historyEntry({ outcome: 'bye' }),
				'BYE',
			],
			[
				'pending',
				historyEntry({ outcome: 'pending', hasResult: false }),
				'Pending',
			],
			[
				'scored win',
				historyEntry({
					outcome: 'win',
					playerGameWins: 2,
					opponentGameWins: 1,
					gameDraws: 0,
				}),
				'WIN 2-1',
			],
			[
				'scored loss',
				historyEntry({
					outcome: 'loss',
					playerGameWins: 0,
					opponentGameWins: 2,
					gameDraws: 0,
				}),
				'LOSS 0-2',
			],
			[
				'scored draw with game draws',
				historyEntry({
					outcome: 'draw',
					playerGameWins: 1,
					opponentGameWins: 1,
					gameDraws: 1,
				}),
				'DRAW 1-1-1',
			],
			[
				'missing game counts',
				historyEntry({ playerGameWins: null, opponentGameWins: null, resultString: '2-1' }),
				'2-1',
			],
			[
				'no result string at all',
				historyEntry({ playerGameWins: null, opponentGameWins: null, resultString: null }),
				'Result',
			],
		])('formats a %s', (_name, row, expected) => {
			const { formatOutcome } = makePlayerHistoryModeData();

			expect(formatOutcome(row)).toBe(expected);
		});

		it('omits a zero game-draw count from the score', () => {
			const { formatOutcome } = makePlayerHistoryModeData();

			expect(formatOutcome(historyEntry({ gameDraws: 0 }))).toBe('WIN 2-1');
			expect(formatOutcome(historyEntry({ gameDraws: null }))).toBe('WIN 2-1');
		});
	});

	it('surfaces the failure message when the first load fails', async () => {
		mutableConfig.playerId = 7;
		mockFetch.mockRejectedValue(new Error('boom'));

		const { error, player } = makePlayerHistoryModeData();
		await flushPromises();

		expect(error.value).toBe('Failed to load player match history');
		expect(player.value).toBeNull();
	});

	it('keeps displayed data and stays quiet when a later load fails', async () => {
		mutableConfig.playerId = 7;
		mockFetch.mockResolvedValueOnce({
			player: mockPlayer,
			history: [
				historyEntry(),
			],
		});

		const { error, player, pageData } = makePlayerHistoryModeData();
		await flushPromises();

		mockFetch.mockRejectedValueOnce(new Error('boom'));
		mutableConfig.playerId = 9;
		await flushPromises();

		expect(error.value).toBeNull();
		expect(player.value).toEqual(mockPlayer);
		expect(pageData.value).toHaveLength(1);
	});

	it('never writes mode config from a rendering, even with auto-page on', async () => {
		// The persist callbacks handed to the pagination runtime fire only from
		// setPage/nextPage/prevPage, which this composable does not expose: a
		// rendering of a Page Rotation computes its page and writes nothing.
		mutableConfig.playerId = 7;
		mutableConfig.autoPageEnabled = true;
		mockInteractive.value = true;
		mockFetch.mockResolvedValue({
			player: mockPlayer,
			history: [
				historyEntry({ id: 1 }),
				historyEntry({ id: 2 }),
			],
		});

		const { pageData } = makePlayerHistoryModeData();
		await flushPromises();

		expect(pageData.value).toHaveLength(2);
		expect(mockScreenStore.updateModeConfig).not.toHaveBeenCalled();
	});

	it('pages rows by the configured page size and current page', async () => {
		mutableConfig.playerId = 7;
		mutableConfig.rowsPerPage = 2;
		mutableConfig.currentPage = 2;
		mockFetch.mockResolvedValue({
			player: mockPlayer,
			history: [
				historyEntry({ id: 1, roundName: 'Round 1' }),
				historyEntry({ id: 2, roundName: 'Round 2' }),
				historyEntry({ id: 3, roundName: 'Round 3' }),
			],
		});

		const { pageData } = makePlayerHistoryModeData();
		await flushPromises();

		expect(pageData.value.map(row => row.roundName)).toEqual(['Round 3']);
	});

	describe('freshness', () => {
		// The Event, the selected Player and the Screen configuration are held
		// constant throughout: only Event Data changes under the output (#601).
		const pending = historyEntry({
			outcome: 'pending',
			hasResult: false,
			playerGameWins: null,
			opponentGameWins: null,
			resultString: null,
		});
		const recorded = historyEntry({
			outcome: 'win',
			hasResult: true,
			playerGameWins: 2,
			opponentGameWins: 0,
		});

		async function showingPendingHistory() {
			mutableConfig.playerId = 7;
			mockFetch.mockResolvedValue({
				player: mockPlayer,
				history: [pending],
			});
			const data = makePlayerHistoryModeData();
			await flushPromises();
			expect(data.formatOutcome(data.pageData.value[0]!)).toBe('Pending');
			mockFetch.mockClear();
			return data;
		}

		function match(overrides: Record<string, unknown> = {}) {
			return {
				id: 1,
				roundId: 31,
				player1Id: 7,
				player2Id: 2,
				...overrides,
			};
		}

		it('shows a Match result recorded elsewhere', async () => {
			const { pageData, formatOutcome } = await showingPendingHistory();
			mockFetch.mockResolvedValue({
				player: mockPlayer,
				history: [recorded],
			});

			deliver('match:updated', {
				match: match({ hasResult: true }),
			});
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(formatOutcome(pageData.value[0]!)).toBe('WIN 2-0');
		});

		it('picks up a new Match for the selected Player', async () => {
			await showingPendingHistory();

			deliver('match:created', {
				match: match({
					id: 5,
					roundId: 32,
					player1Id: 3,
					player2Id: 7,
				}),
			});
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('drops a held Match that is deleted or re-paired away from the Player', async () => {
			await showingPendingHistory();

			deliver('match:deleted', { matchId: 1 });
			await flushPromises();
			deliver('match:updated', {
				match: match({ player1Id: 3, player2Id: 4 }),
			});
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('ignores Matches that are neither held nor the Player\'s', async () => {
			await showingPendingHistory();

			deliver('match:updated', {
				match: match({ id: 9, player1Id: 3, player2Id: 4 }),
			});
			deliver('match:deleted', { matchId: 9 });
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('re-reads when a held Round changes, and not for another Round', async () => {
			await showingPendingHistory();

			deliver('round:updated', {
				round: { id: 40 },
			});
			deliver('round:deleted', { roundId: 40 });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('round:updated', {
				round: { id: 31 },
			});
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(1);

			deliver('round:matchesRefreshed', {
				roundId: 40,
				matchCount: 8,
				created: 1,
				updated: 0,
				staleDeleted: 0,
			});
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);
		});

		it('follows an edit to the selected Player\'s record or an opponent\'s, and no one else\'s', async () => {
			const { player } = await showingPendingHistory();
			mockFetch.mockResolvedValue({
				player: { ...mockPlayer, wins: 13 },
				history: [pending],
			});

			deliver('player:updated', {
				player: { id: 5 },
			});
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			deliver('player:updated', {
				player: { id: 7 },
			});
			await flushPromises();
			expect(player.value?.wins).toBe(13);

			deliver('player:updated', {
				player: { id: 2 },
			});
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(2);

			deliver('player:deleted', { playerId: 7 });
			await flushPromises();
			expect(mockFetch).toHaveBeenCalledTimes(3);
		});

		it('shows a result missed while disconnected once its channel is attached again', async () => {
			const { pageData, formatOutcome } = await showingPendingHistory();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			mockFetch.mockResolvedValue({
				player: mockPlayer,
				history: [recorded],
			});
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(formatOutcome(pageData.value[0]!)).toBe('WIN 2-0');
		});
	});
});
