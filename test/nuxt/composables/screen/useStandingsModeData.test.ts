import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockEvent, createMockPlayer, createMockRound } from '~~/test/helpers/fixtures';

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

const mockPlayerStore = reactive({
	players: [...players],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
});

const mockPlayerListStore = reactive({
	lists: [] as any[],
	isLoaded: true,
	loadByEventId: vi.fn(),
});

const mockPlayerListRepo = {
	getById: vi.fn(),
};

const mockRoundStore = reactive({
	rounds: [] as any[],
	isLoaded: true,
	loadRoundsByEventId: vi.fn(),
	getRoundById: vi.fn((id: number) => mockRoundStore.rounds.find((round: any) => round.id === id)),
});

const mockScreenStore = {
	updateModeConfig: vi.fn(),
};

const mockEventStore = reactive({
	event: createMockEvent(),
});

// Mutable eventId and interactive for null-eventId and timer tests
const mockEventId = ref<number | null>(1);
const mockInteractiveStandings = ref(false);
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

mockNuxtImport('$fetch', () => mockFetch);

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('usePlayerListStore', () => () => mockPlayerListStore);
mockNuxtImport('usePlayerListRepository', () => () => mockPlayerListRepo);
mockNuxtImport('useRoundStore', () => () => mockRoundStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: mockInteractiveStandings,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

// ──────────────── Tests ────────────────

describe('useStandingsModeData', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		mockPlayerStore.players = [...players];
		mockPlayerStore.isLoaded = true;
		mockPlayerListStore.lists = [];
		mockPlayerListStore.isLoaded = true;
		mockRoundStore.rounds = [];
		mockRoundStore.isLoaded = true;
		mockEventStore.event = createMockEvent();
		mockEventId.value = 1;
		mockInteractiveStandings.value = false;
		mockFetch.mockReset();
		vi.clearAllMocks();
	});

	// ── Core properties ──

	it('returns expected properties', () => {
		const result = useStandingsModeData();
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
		it('returns all players in "all" mode', () => {
			mutableConfig.viewMode = 'all';
			const { displayRows } = useStandingsModeData();
			expect(displayRows.value).toHaveLength(10);
		});

		it('returns top N players in "topN" mode', () => {
			mutableConfig.viewMode = 'topN';
			mutableConfig.topNCount = 3;
			const { displayRows } = useStandingsModeData();
			expect(displayRows.value).toHaveLength(3);
			expect(displayRows.value[0]!.name).toBe('Alice');
			expect(displayRows.value[2]!.name).toBe('Charlie');
		});

		it('returns players in position range for "slice" mode', () => {
			mutableConfig.viewMode = 'slice';
			mutableConfig.sliceStart = 3;
			mutableConfig.sliceEnd = 5;
			const { displayRows } = useStandingsModeData();
			expect(displayRows.value).toHaveLength(3);
			expect(displayRows.value[0]!.name).toBe('Charlie');
			expect(displayRows.value[2]!.name).toBe('Ethan');
		});

		it('excludes players without position in "slice" mode', () => {
			mutableConfig.viewMode = 'slice';
			mutableConfig.sliceStart = 1;
			mutableConfig.sliceEnd = 10;
			mockPlayerStore.players = [
				...players,
				createMockPlayer({ id: 99, name: 'NoPos', position: null }),
			];
			const { displayRows } = useStandingsModeData();
			expect(displayRows.value.find(p => p.name === 'NoPos')).toBeUndefined();
		});

		it('returns watchlist members in "watchlist" mode', () => {
			mutableConfig.viewMode = 'watchlist';
			const { displayRows } = useStandingsModeData();
			// Before watchlist loads, IDs are empty → 0 rows
			expect(displayRows.value).toHaveLength(0);
		});

		it('returns first N players in "reveal" mode with bottomUp', () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealCount = 8;
			mutableConfig.revealedCount = 3;
			mutableConfig.revealOrder = 'bottomUp';
			const { displayRows } = useStandingsModeData();
			// bottomUp: show last 3 of top 8 → positions 6, 7, 8
			expect(displayRows.value).toHaveLength(3);
			expect(displayRows.value[0]!.name).toBe('Fiona');
			expect(displayRows.value[2]!.name).toBe('Helen');
		});

		it('returns first N players in "reveal" mode with topDown', () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealCount = 8;
			mutableConfig.revealedCount = 3;
			mutableConfig.revealOrder = 'topDown';
			const { displayRows } = useStandingsModeData();
			// topDown: show first 3 of top 8 → positions 1, 2, 3
			expect(displayRows.value).toHaveLength(3);
			expect(displayRows.value[0]!.name).toBe('Alice');
			expect(displayRows.value[2]!.name).toBe('Charlie');
		});

		it('returns empty when revealedCount is 0', () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealCount = 8;
			mutableConfig.revealedCount = 0;
			const { displayRows } = useStandingsModeData();
			expect(displayRows.value).toHaveLength(0);
		});

		it('uses round snapshot standings when roundId is selected', async () => {
			mutableConfig.roundId = 7;
			mockRoundStore.rounds = [createMockRound({ id: 7, name: 'Round 7' })];
			mockFetch.mockResolvedValue({
				standings: [
					{ playerId: 3, wins: 5, losses: 0, draws: 0, position: 1, points: 15 },
					{ playerId: 1, wins: 4, losses: 1, draws: 0, position: 2, points: 12 },
				],
			});

			const { displayRows } = useStandingsModeData();
			await nextTick();
			await nextTick();

			expect(mockFetch).toHaveBeenCalledWith('/api/events/1/standings?roundId=7');
			expect(displayRows.value).toHaveLength(2);
			expect(displayRows.value.map(p => p.name)).toEqual(['Charlie', 'Alice']);
			expect(displayRows.value[0]!.wins).toBe(5);
			expect(displayRows.value[0]!.position).toBe(1);
		});
	});

	// ── headerText ──

	describe('headerText', () => {
		it('returns custom header when headerText is set', () => {
			mutableConfig.headerText = 'Custom Header';
			const { headerText } = useStandingsModeData();
			expect(headerText.value).toBe('Custom Header');
		});

		it('returns "Standings" for "all" mode', () => {
			mutableConfig.viewMode = 'all';
			mutableConfig.headerText = '';
			const { headerText } = useStandingsModeData();
			expect(headerText.value).toBe('Standings');
		});

		it('returns "Top N Standings" for "topN" mode', () => {
			mutableConfig.viewMode = 'topN';
			mutableConfig.topNCount = 16;
			mutableConfig.headerText = '';
			const { headerText } = useStandingsModeData();
			expect(headerText.value).toBe('Top 16 Standings');
		});

		it('returns range for "slice" mode', () => {
			mutableConfig.viewMode = 'slice';
			mutableConfig.sliceStart = 9;
			mutableConfig.sliceEnd = 16;
			mutableConfig.headerText = '';
			const { headerText } = useStandingsModeData();
			expect(headerText.value).toBe('Standings (9-16)');
		});

		it('returns player list name for "watchlist" mode', () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 42;
			mutableConfig.headerText = '';
			mockPlayerListStore.lists = [{ id: 42, name: 'VIPs' }];
			const { headerText } = useStandingsModeData();
			expect(headerText.value).toBe('VIPs');
		});

		it('returns fallback for "watchlist" when list not found', () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 999;
			mutableConfig.headerText = '';
			const { headerText } = useStandingsModeData();
			expect(headerText.value).toBe('Players to Watch');
		});

		it('returns "Top N" for "reveal" mode', () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealCount = 8;
			mutableConfig.headerText = '';
			const { headerText } = useStandingsModeData();
			expect(headerText.value).toBe('Top 8');
		});

		it('returns round header when roundId is selected', async () => {
			mutableConfig.roundId = 4;
			mutableConfig.headerText = '';
			mockRoundStore.rounds = [createMockRound({ id: 4, name: 'Round 4' })];
			mockFetch.mockResolvedValue({
				standings: [{ playerId: 1, wins: 5, losses: 0, draws: 0, position: 1, points: 15 }],
			});

			const { headerText } = useStandingsModeData();
			await nextTick();
			await nextTick();

			expect(headerText.value).toBe('End of Round 4');
		});
	});

	// ── visibleColumns ──

	describe('visibleColumns', () => {
		it('filters to only visible columns', () => {
			mutableConfig.columns = [
				{ key: 'position', visible: true },
				{ key: 'name', visible: true },
				{ key: 'record', visible: false },
				{ key: 'points', visible: false },
				{ key: 'deck', visible: true },
			];
			const { visibleColumns } = useStandingsModeData();
			expect(visibleColumns.value).toHaveLength(3);
			expect(visibleColumns.value.map((c: any) => c.key)).toEqual(['position', 'name', 'deck']);
		});

		it('returns empty when no columns are visible', () => {
			mutableConfig.columns = [
				{ key: 'position', visible: false },
				{ key: 'name', visible: false },
			];
			const { visibleColumns } = useStandingsModeData();
			expect(visibleColumns.value).toHaveLength(0);
		});
	});

	// ── Pagination ──
});
