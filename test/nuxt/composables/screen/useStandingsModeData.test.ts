import type { EffectScope } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockPlayer, createMockRound } from '~~/test/helpers/fixtures';
import { createContinuitySignal } from '~~/test/helpers/realtime-mock';

// ── Shared mutable config ──

const defaultConfig = {
	viewMode: 'all' as string,
	topNCount: 8,
	columns: [
		{ key: 'position', visible: true },
		{ key: 'name', visible: true },
		{ key: 'record', visible: true },
		{ key: 'points', visible: true },
		{ key: 'deck', visible: false },
	],
	showArchetypeColors: false,
	maxTableWidth: undefined,
	roundId: undefined as number | undefined,
	rowsPerPage: 10,
	currentPage: 1,
	autoPageEnabled: false,
	autoPageIntervalMs: 5000,
	headerText: '',
	sliceStart: 1,
	sliceEnd: 16,
	revealCount: 8,
	revealedCount: 0,
	revealOrder: 'bottomUp' as string,
	revealTrigger: 'manual',
	playerListId: null as number | null,
};

const mutableConfig = reactive({ ...defaultConfig });

// ── Players ──

const players = [
	createMockPlayer({ id: 1, name: 'Alice', position: 1, wins: 5, losses: 1, draws: 0, points: 15 }),
	createMockPlayer({ id: 2, name: 'Bob', position: 2, wins: 4, losses: 2, draws: 0, points: 12 }),
	createMockPlayer({ id: 3, name: 'Charlie', position: 3, wins: 3, losses: 3, draws: 0, points: 9 }),
	createMockPlayer({ id: 4, name: 'Diana', position: 4, wins: 3, losses: 3, draws: 1, points: 10 }),
	createMockPlayer({ id: 5, name: 'Ethan', position: 5, wins: 2, losses: 4, draws: 0, points: 6 }),
	createMockPlayer({ id: 6, name: 'Fiona', position: 6, wins: 1, losses: 5, draws: 0, points: 3 }),
	createMockPlayer({ id: 7, name: 'George', position: 7, wins: 1, losses: 5, draws: 1, points: 4 }),
	createMockPlayer({ id: 8, name: 'Helen', position: 8, wins: 0, losses: 6, draws: 0, points: 0 }),
	createMockPlayer({ id: 9, name: 'Ivan', position: 9, wins: 0, losses: 6, draws: 0, points: 0 }),
	createMockPlayer({ id: 10, name: 'Jane', position: 10, wins: 0, losses: 6, draws: 0, points: 0 }),
];

// ── Mocks ──

/** The roster the server holds; the Standings read answers it. */
let serverPlayers = [...players];

/**
 * An operator's Player store, loaded and stale. A rendering reads its roster
 * through the Screen, so what this holds must never reach its rows (#603).
 */
const mockPlayerStore = reactive({
	players: [createMockPlayer({ id: 99, name: 'Stale Store Player', position: 1 })],
	isLoaded: true,
	loadPlayersFrom: vi.fn(),
});

const mockScreenStore = {
	updateModeConfig: vi.fn(),
};

const mockEventStore = reactive({
	displayEvent: createMockEvent(),
});

// Mutable eventId and interactive for null-eventId and timer tests
const mockEventId = ref<number | null>(1);
const mockInteractiveStandings = ref(false);
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

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: mockInteractiveStandings,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

/** The Standings Screen Output read's answer; by default, the roster as it stands. */
function standingsRead(overrides: Record<string, unknown> = {}) {
	return { players: [...serverPlayers], round: null, roundStandings: null, watchlist: null, previousRoundPositions: null, ...overrides };
}

const STANDINGS_READ = '/api/screen-output/events/1/screens/1/standings';

const scopes: EffectScope[] = [];

/** A rendering of Standings, its first read answered. */
async function mountStandings() {
	const scope = effectScope();
	scopes.push(scope);
	const result = scope.run(() => useStandingsModeData())!;
	await flushPromises();
	return result;
}

// ──────────────── Tests ────────────────

describe('useStandingsModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		serverPlayers = [...players];
		mockRealtime.connectionState = 'connected';
		mockRealtime.tokenError = null;
		mockEventStore.displayEvent = createMockEvent();
		mockEventId.value = 1;
		mockInteractiveStandings.value = false;
		mockFetch.mockReset();
		vi.clearAllMocks();
		mockFetch.mockImplementation(async () => standingsRead());
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	// ── Core properties ──

	it('returns expected properties', async () => {
		const result = await mountStandings();
		expect(result).toHaveProperty('displayRows');
		expect(result).toHaveProperty('headerText');
		expect(result).toHaveProperty('visibleColumns');
		expect(result).toHaveProperty('pageData');
		expect(result).toHaveProperty('totalPages');
		expect(result).toHaveProperty('currentPage');
		expect(result).toHaveProperty('formatCell');
		expect(result).toHaveProperty('nextPage');
		expect(result).toHaveProperty('prevPage');
		expect(result).toHaveProperty('setPage');
	});

	// ── displayRows: view modes ──

	describe('displayRows', () => {
		it('returns all players in "all" mode', async () => {
			mutableConfig.viewMode = 'all';
			const { displayRows } = await mountStandings();
			expect(displayRows.value).toHaveLength(10);
		});

		it('returns top N players in "topN" mode', async () => {
			mutableConfig.viewMode = 'topN';
			mutableConfig.topNCount = 3;
			const { displayRows } = await mountStandings();
			expect(displayRows.value).toHaveLength(3);
			expect(displayRows.value[0]!.name).toBe('Alice');
			expect(displayRows.value[2]!.name).toBe('Charlie');
		});

		it('returns players in position range for "slice" mode', async () => {
			mutableConfig.viewMode = 'slice';
			mutableConfig.sliceStart = 3;
			mutableConfig.sliceEnd = 5;
			const { displayRows } = await mountStandings();
			expect(displayRows.value).toHaveLength(3);
			expect(displayRows.value[0]!.name).toBe('Charlie');
			expect(displayRows.value[2]!.name).toBe('Ethan');
		});

		it('excludes players without position in "slice" mode', async () => {
			mutableConfig.viewMode = 'slice';
			mutableConfig.sliceStart = 1;
			mutableConfig.sliceEnd = 10;
			serverPlayers = [
				...players,
				createMockPlayer({ id: 99, name: 'NoPos', position: null }),
			];
			const { displayRows } = await mountStandings();
			expect(displayRows.value.find(p => p.name === 'NoPos')).toBeUndefined();
		});

		it('returns watchlist members in "watchlist" mode', async () => {
			mutableConfig.viewMode = 'watchlist';
			const { displayRows } = await mountStandings();
			// Before watchlist loads, IDs are empty → 0 rows
			expect(displayRows.value).toHaveLength(0);
		});

		it('returns first N players in "reveal" mode with bottomUp', async () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealCount = 8;
			mutableConfig.revealedCount = 3;
			mutableConfig.revealOrder = 'bottomUp';
			const { displayRows } = await mountStandings();
			// bottomUp: show last 3 of top 8 → positions 6, 7, 8
			expect(displayRows.value).toHaveLength(3);
			expect(displayRows.value[0]!.name).toBe('Fiona');
			expect(displayRows.value[2]!.name).toBe('Helen');
		});

		it('returns first N players in "reveal" mode with topDown', async () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealCount = 8;
			mutableConfig.revealedCount = 3;
			mutableConfig.revealOrder = 'topDown';
			const { displayRows } = await mountStandings();
			// topDown: show first 3 of top 8 → positions 1, 2, 3
			expect(displayRows.value).toHaveLength(3);
			expect(displayRows.value[0]!.name).toBe('Alice');
			expect(displayRows.value[2]!.name).toBe('Charlie');
		});

		it('returns empty when revealedCount is 0', async () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealCount = 8;
			mutableConfig.revealedCount = 0;
			const { displayRows } = await mountStandings();
			expect(displayRows.value).toHaveLength(0);
		});

		it('uses round snapshot standings when roundId is selected', async () => {
			mutableConfig.roundId = 7;
			mockFetch.mockImplementation(async () => standingsRead({
				round: createMockRound({ id: 7, name: 'Round 7' }),
				roundStandings: [
					{ playerId: 3, wins: 5, losses: 0, draws: 0, position: 1, points: 15 },
					{ playerId: 1, wins: 4, losses: 1, draws: 0, position: 2, points: 12 },
				],
			}));

			const { displayRows } = await mountStandings();

			expect(mockFetch).toHaveBeenCalledWith(STANDINGS_READ, expect.anything());
			expect(displayRows.value).toHaveLength(2);
			expect(displayRows.value.map(p => p.name)).toEqual(['Charlie', 'Alice']);
			expect(displayRows.value[0]!.wins).toBe(5);
			expect(displayRows.value[0]!.position).toBe(1);
		});

		it('renders the roster the Standings read answers, never the Player store\'s', async () => {
			serverPlayers = [createMockPlayer({ id: 21, name: 'Read Player', position: 1 })];

			const { displayRows } = await mountStandings();

			expect(mockPlayerStore.loadPlayersFrom).not.toHaveBeenCalled();
			expect(displayRows.value.map(p => p.name)).toEqual(['Read Player']);
		});

		it('filters to the watchlist members the read answers', async () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 42;
			mockFetch.mockImplementation(async () => standingsRead({ watchlist: { name: 'VIPs', playerIds: [2, 4] } }));

			const { displayRows } = await mountStandings();

			expect(displayRows.value.map(p => p.name)).toEqual(['Bob', 'Diana']);
		});
	});

	// ── headerText ──

	describe('headerText', () => {
		it('returns custom header when headerText is set', async () => {
			mutableConfig.headerText = 'Custom Header';
			const { headerText } = await mountStandings();
			expect(headerText.value).toBe('Custom Header');
		});

		it('returns "Standings" for "all" mode', async () => {
			mutableConfig.viewMode = 'all';
			mutableConfig.headerText = '';
			const { headerText } = await mountStandings();
			expect(headerText.value).toBe('Standings');
		});

		it('returns "Top N Standings" for "topN" mode', async () => {
			mutableConfig.viewMode = 'topN';
			mutableConfig.topNCount = 16;
			mutableConfig.headerText = '';
			const { headerText } = await mountStandings();
			expect(headerText.value).toBe('Top 16 Standings');
		});

		it('returns range for "slice" mode', async () => {
			mutableConfig.viewMode = 'slice';
			mutableConfig.sliceStart = 9;
			mutableConfig.sliceEnd = 16;
			mutableConfig.headerText = '';
			const { headerText } = await mountStandings();
			expect(headerText.value).toBe('Standings (9-16)');
		});

		it('returns player list name for "watchlist" mode', async () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 42;
			mutableConfig.headerText = '';
			mockFetch.mockImplementation(async () => standingsRead({ watchlist: { name: 'VIPs', playerIds: [] } }));
			const { headerText } = await mountStandings();
			expect(headerText.value).toBe('VIPs');
		});

		it('returns fallback for "watchlist" when list not found', async () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 999;
			mutableConfig.headerText = '';
			const { headerText } = await mountStandings();
			expect(headerText.value).toBe('Players to Watch');
		});

		it('returns "Top N" for "reveal" mode', async () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealCount = 8;
			mutableConfig.headerText = '';
			const { headerText } = await mountStandings();
			expect(headerText.value).toBe('Top 8');
		});

		it('returns round header when roundId is selected', async () => {
			mutableConfig.roundId = 4;
			mutableConfig.headerText = '';
			mockFetch.mockImplementation(async () => standingsRead({
				round: createMockRound({ id: 4, name: 'Round 4' }),
				roundStandings: [{ playerId: 1, wins: 5, losses: 0, draws: 0, position: 1, points: 15 }],
			}));

			const { headerText } = await mountStandings();

			expect(headerText.value).toBe('End of Round 4');
		});
	});

	// ── visibleColumns ──

	describe('visibleColumns', () => {
		it('filters to only visible columns', async () => {
			mutableConfig.columns = [
				{ key: 'position', visible: true },
				{ key: 'name', visible: true },
				{ key: 'record', visible: false },
				{ key: 'points', visible: false },
				{ key: 'deck', visible: true },
			];
			const { visibleColumns } = await mountStandings();
			expect(visibleColumns.value).toHaveLength(3);
			expect(visibleColumns.value.map((c: any) => c.key)).toEqual(['position', 'name', 'deck']);
		});

		it('returns empty when no columns are visible', async () => {
			mutableConfig.columns = [
				{ key: 'position', visible: false },
				{ key: 'name', visible: false },
			];
			const { visibleColumns } = await mountStandings();
			expect(visibleColumns.value).toHaveLength(0);
		});
	});

	// ── Freshness ──

	describe('freshness', () => {
		// The Event, the Screen and its configuration are held constant
		// throughout: only Event Data changes under the output (#603).
		const names = (rows: { name: string }[]) => rows.map(row => row.name);

		it('follows a Player edit made elsewhere', async () => {
			const { displayRows } = await mountStandings();
			mockFetch.mockClear();

			serverPlayers = serverPlayers.map(p => p.id === 2 ? { ...p, wins: 5, points: 15 } : p);
			deliver('player:updated', { player: serverPlayers[1] });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(displayRows.value[1]).toMatchObject({ name: 'Bob', wins: 5, points: 15 });
		});

		it('follows a Player added or removed elsewhere', async () => {
			const { displayRows } = await mountStandings();

			const added = createMockPlayer({ id: 11, name: 'Kim', position: 11 });
			serverPlayers = [...serverPlayers, added];
			deliver('player:created', { player: added });
			await flushPromises();
			expect(names(displayRows.value)).toContain('Kim');

			serverPlayers = serverPlayers.filter(p => p.id !== 3);
			deliver('player:deleted', { playerId: 3 });
			await flushPromises();
			expect(names(displayRows.value)).not.toContain('Charlie');
		});

		it('follows the watchlist\'s membership and name, and no other list', async () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 42;
			let watchlist = { name: 'VIPs', playerIds: [2, 4] };
			mockFetch.mockImplementation(async () => standingsRead({ watchlist }));
			const { displayRows, headerText } = await mountStandings();
			mockFetch.mockClear();

			deliver('playerList:membersChanged', { listId: 7, playerIds: [1], action: 'added', memberCount: 1 });
			await flushPromises();
			expect(mockFetch).not.toHaveBeenCalled();

			watchlist = { name: 'VIPs', playerIds: [2] };
			deliver('playerList:membersChanged', { listId: 42, playerIds: [4], action: 'removed', memberCount: 1 });
			await flushPromises();
			expect(names(displayRows.value)).toEqual(['Bob']);

			watchlist = { name: 'Feature Players', playerIds: [2] };
			deliver('playerList:updated', { playerList: { id: 42, name: 'Feature Players' } });
			await flushPromises();
			expect(headerText.value).toBe('Feature Players');
		});

		it('follows a Melee sync of the standings it shows', async () => {
			mutableConfig.roundId = 7;
			let roundStandings = [{ playerId: 1, wins: 4, losses: 1, draws: 0, position: 1, points: 12 }];
			mockFetch.mockImplementation(async () => standingsRead({ round: createMockRound({ id: 7, name: 'Round 7' }), roundStandings }));
			const { displayRows } = await mountStandings();

			roundStandings = [{ playerId: 1, wins: 5, losses: 1, draws: 0, position: 1, points: 15 }];
			deliver('melee:roundSynced', { roundId: 7, matchCount: 8, created: 0, updated: 8, staleDeleted: 0 });
			await flushPromises();

			expect(displayRows.value[0]!.wins).toBe(5);
		});

		it('shows current standings, not the cached roster, once its channel is attached again', async () => {
			const { displayRows } = await mountStandings();
			mockFetch.mockClear();

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			// Missed while disconnected: a result, an addition and a deletion.
			serverPlayers = [
				...serverPlayers.filter(p => p.id !== 1).map(p => p.id === 2 ? { ...p, position: 1, wins: 5 } : p),
				createMockPlayer({ id: 11, name: 'Kim', position: 11 }),
			];
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(names(displayRows.value)).not.toContain('Alice');
			expect(names(displayRows.value)).toContain('Kim');
			expect(displayRows.value[0]).toMatchObject({ name: 'Bob', wins: 5 });
		});

		it('keeps the last accepted standings on program while the resync read is in flight', async () => {
			const { displayRows, isEmpty } = await mountStandings();
			let answer!: (value: unknown) => void;
			mockFetch.mockReturnValue(new Promise((resolve) => {
				answer = resolve;
			}));

			mockRealtime.connectionState = 'disconnected';
			await nextTick();
			mockRealtime.connectionState = 'connected';
			continuity.reattach('event:1');
			await flushPromises();

			expect(displayRows.value).toHaveLength(10);
			expect(isEmpty.value).toBe(false);

			answer(standingsRead({ players: serverPlayers.slice(0, 2) }));
			await flushPromises();
			expect(displayRows.value).toHaveLength(2);
		});
	});

	// ── Position Change ──

	describe('the Position Change column', () => {
		const withPositionChange = [
			{ key: 'position', visible: true },
			{ key: 'name', visible: true },
			{ key: 'positionChange', visible: true },
		];
		// Round 7's Round Standings, measured against Round 6's.
		const roundSeven = {
			round: createMockRound({ id: 7, name: 'Round 7' }),
			roundStandings: [
				{ playerId: 3, wins: 5, losses: 0, draws: 0, position: 1, points: 15 },
				{ playerId: 1, wins: 4, losses: 1, draws: 0, position: 2, points: 12 },
				{ playerId: 2, wins: 4, losses: 1, draws: 0, position: 3, points: 12 },
				{ playerId: 4, wins: 3, losses: 2, draws: 0, position: 4, points: 9 },
			],
			previousRoundPositions: {
				roundId: 6,
				positions: [
					{ playerId: 1, position: 1 },
					{ playerId: 2, position: 3 },
					{ playerId: 3, position: 4 },
				],
			},
		};
		const positionChanges = (result: Awaited<ReturnType<typeof mountStandings>>) =>
			result.pageData.value.map(player => [player.name, result.formatCell(player, 'positionChange')]);

		it('shows each Player\'s Position Change since the previous Round', async () => {
			mutableConfig.columns = withPositionChange;
			mutableConfig.roundId = 7;
			mockFetch.mockImplementation(async () => standingsRead(roundSeven));

			const result = await mountStandings();

			expect(positionChanges(result)).toEqual([
				['Charlie', '▲3'],
				['Alice', '▼1'],
				['Bob', '–'],
				['Diana', 'new'],
			]);
			expect(result.positionChangeOf(result.pageData.value[0]!)).toEqual({ kind: 'up', by: 3 });
		});

		it('shows a neutral marker for every Player when there is no previous Round', async () => {
			mutableConfig.columns = withPositionChange;
			mutableConfig.roundId = 7;
			mockFetch.mockImplementation(async () => standingsRead({ ...roundSeven, previousRoundPositions: null }));

			const result = await mountStandings();

			expect(positionChanges(result).map(([, change]) => change)).toEqual(['–', '–', '–', '–']);
		});

		it('keeps each Player\'s Position Change whichever rows the view shows', async () => {
			mutableConfig.columns = withPositionChange;
			mutableConfig.roundId = 7;
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 42;
			mockFetch.mockImplementation(async () => standingsRead({ ...roundSeven, watchlist: { name: 'VIPs', playerIds: [1, 4] } }));

			const result = await mountStandings();

			expect(positionChanges(result)).toEqual([['Alice', '▼1'], ['Diana', 'new']]);
		});

		it.each([
			['topN', { topNCount: 2 }, [['Charlie', '▲3'], ['Alice', '▼1']]],
			['slice', { sliceStart: 2, sliceEnd: 3 }, [['Alice', '▼1'], ['Bob', '–']]],
			['reveal', { revealCount: 4, revealedCount: 1, revealOrder: 'bottomUp' }, [['Diana', 'new']]],
		] as const)('keeps each Player\'s Position Change in the %s view', async (viewMode, view, expected) => {
			Object.assign(mutableConfig, { columns: withPositionChange, roundId: 7, viewMode, ...view });
			mockFetch.mockImplementation(async () => standingsRead(roundSeven));

			const result = await mountStandings();

			expect(positionChanges(result)).toEqual(expected);
		});

		it('reads again when the column is shown, so the previous Round is read only for a Screen showing it', async () => {
			mutableConfig.roundId = 7;
			mockFetch.mockImplementation(async () => standingsRead(roundSeven));
			await mountStandings();
			mockFetch.mockClear();

			mutableConfig.columns = withPositionChange;
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('follows a change to the Event\'s Round order while the column shows', async () => {
			mutableConfig.columns = withPositionChange;
			mutableConfig.roundId = 7;
			mockFetch.mockImplementation(async () => standingsRead(roundSeven));
			await mountStandings();
			mockFetch.mockClear();

			deliver('round:updated', { round: createMockRound({ id: 3, name: 'Round 3' }) });
			await flushPromises();
			deliver('phase:updated', { phase: { id: 1 } });
			await flushPromises();
			deliver('round:deleted', { roundId: 6 });
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(3);
		});

		it('ignores another Round\'s change while the column is hidden', async () => {
			mutableConfig.roundId = 7;
			mockFetch.mockImplementation(async () => standingsRead(roundSeven));
			await mountStandings();
			mockFetch.mockClear();

			deliver('round:updated', { round: createMockRound({ id: 3, name: 'Round 3' }) });
			deliver('phase:updated', { phase: { id: 1 } });
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});
	});
});
