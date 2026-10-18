import type { EffectScope } from 'vue';
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
	rotationAnchor: undefined as number | undefined,
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
	// The roster the Standings read answers is held in the Player store.
	loadPlayersFrom: vi.fn(async (_eventId: number, loader: () => Promise<any[]>) => {
		mockPlayerStore.players = await loader();
	}),
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

mockNuxtImport('$fetch', () => mockFetch);

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useEventStore', () => () => mockEventStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test' }),
	eventId: mockEventId,
	interactive: mockInteractiveStandings,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

// Server time is the Page Rotation's clock; synced and controllable here.
const mockIsSynced = ref(true);
let mockServerNow = 1_000_000;
mockNuxtImport('useServerTime', () => () => ({
	isSynced: mockIsSynced,
	serverTimeOffset: ref(0),
	getServerTime: () => mockServerNow,
}));

/** The Standings Screen Output read's answer; by default, the roster as it stands. */
function standingsRead(overrides: Record<string, unknown> = {}) {
	return { players: [...mockPlayerStore.players], round: null, roundStandings: null, watchlist: null, ...overrides };
}

const STANDINGS_READ = '/api/screen-output/events/1/screens/1/standings';

/**
 * Every rendering is stopped after its test: a live one re-reads whenever the
 * shared configuration or Event changes, so leaked ones would count against
 * the next test's reads.
 */
const scopes: EffectScope[] = [];

function makeStandings() {
	const scope = effectScope();
	scopes.push(scope);
	return scope.run(() => useStandingsModeData())!;
}

// ──────────────── Tests ────────────────

describe('useStandingsModeData pagination and formatting', () => {
	beforeEach(() => {
		Object.assign(mutableConfig, defaultConfig);
		mockPlayerStore.players = [...players];
		mockPlayerStore.isLoaded = true;
		mockEventStore.displayEvent = createMockEvent();
		mockEventId.value = 1;
		mockInteractiveStandings.value = false;
		mockIsSynced.value = true;
		mockServerNow = 1_000_000;
		mockFetch.mockReset();
		vi.clearAllMocks();
		mockFetch.mockImplementation(async () => standingsRead());
	});

	afterEach(() => {
		scopes.splice(0).forEach(scope => scope.stop());
	});

	// ── Core properties ──

	it('returns expected properties', () => {
		const result = makeStandings();
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

	describe('pagination', () => {
		it('computes totalPages from displayRows and rowsPerPage', () => {
			mutableConfig.viewMode = 'all';
			mutableConfig.rowsPerPage = 3;
			const { totalPages } = makeStandings();
			// 10 players / 3 per page = 4 pages
			expect(totalPages.value).toBe(4);
		});

		it('returns at least 1 page when no rows', () => {
			mockPlayerStore.players = [];
			const { totalPages } = makeStandings();
			expect(totalPages.value).toBe(1);
		});

		it('returns correct page slice', () => {
			mutableConfig.viewMode = 'all';
			mutableConfig.rowsPerPage = 3;
			mutableConfig.currentPage = 2;
			const { pageData } = makeStandings();
			expect(pageData.value).toHaveLength(3);
			expect(pageData.value[0]!.name).toBe('Diana');
		});

		it('clamps to last page if currentPage exceeds totalPages', () => {
			mutableConfig.viewMode = 'all';
			mutableConfig.rowsPerPage = 5;
			mutableConfig.currentPage = 100;
			const { pageData } = makeStandings();
			// Should show page 2 (last page): players 6-10
			expect(pageData.value).toHaveLength(5);
			expect(pageData.value[0]!.name).toBe('Fiona');
		});

		it('setPage calls screenStore.updateModeConfig', () => {
			mockInteractiveStandings.value = true;
			mutableConfig.viewMode = 'all';
			mutableConfig.rowsPerPage = 3; // 10 players / 3 = 4 pages
			const { setPage } = makeStandings();
			setPage(3);
			expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
				1,
				1,
				'standings',
				{ currentPage: 3 },
			);
		});

		it('setPage clamps below 1', () => {
			mockInteractiveStandings.value = true;
			const { setPage } = makeStandings();
			setPage(0);
			expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
				1,
				1,
				'standings',
				{ currentPage: 1 },
			);
		});

		it('setPage clamps above totalPages', () => {
			mockInteractiveStandings.value = true;
			mutableConfig.viewMode = 'all';
			mutableConfig.rowsPerPage = 5;
			const { setPage } = makeStandings();
			setPage(100);
			expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
				1,
				1,
				'standings',
				{ currentPage: 2 },
			);
		});

		it('nextPage wraps to page 1 after last page', () => {
			mockInteractiveStandings.value = true;
			mutableConfig.viewMode = 'all';
			mutableConfig.rowsPerPage = 5;
			mutableConfig.currentPage = 2; // last page (10 / 5 = 2)
			const { nextPage } = makeStandings();
			nextPage();
			expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
				1,
				1,
				'standings',
				{ currentPage: 1 },
			);
		});

		it('prevPage wraps to last page from page 1', () => {
			mockInteractiveStandings.value = true;
			mutableConfig.viewMode = 'all';
			mutableConfig.rowsPerPage = 5;
			mutableConfig.currentPage = 1;
			const { prevPage } = makeStandings();
			prevPage();
			expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
				1,
				1,
				'standings',
				{ currentPage: 2 },
			);
		});
	});

	// ── formatCell ──

	describe('formatCell', () => {
		it('formats position', () => {
			const { formatCell } = makeStandings();
			expect(formatCell(players[0] as any, 'position')).toBe('1');
		});

		it('formats position as dash when null', () => {
			const { formatCell } = makeStandings();
			const noPos = createMockPlayer({ position: null });
			expect(formatCell(noPos as any, 'position')).toBe('-');
		});

		it('formats name', () => {
			const { formatCell } = makeStandings();
			expect(formatCell(players[1] as any, 'name')).toBe('Bob');
		});

		it('formats record as W-L (hides zero draws by default)', () => {
			const { formatCell } = makeStandings();
			expect(formatCell(players[0] as any, 'record')).toBe('5-1');
		});

		it('formats record with draws when non-zero', () => {
			const { formatCell } = makeStandings();
			expect(formatCell(players[3] as any, 'record')).toBe('3-3-1');
		});

		it('formats record with custom separator', () => {
			mockEventStore.displayEvent = createMockEvent({ displayRecordSeparator: '/' });
			const { formatCell } = makeStandings();
			expect(formatCell(players[0] as any, 'record')).toBe('5/1');
		});

		it('formats record showing zero draws when hideZeroDraws is false', () => {
			mockEventStore.displayEvent = createMockEvent({ displayHideZeroDraws: false });
			const { formatCell } = makeStandings();
			expect(formatCell(players[0] as any, 'record')).toBe('5-1-0');
		});

		it('formats points', () => {
			const { formatCell } = makeStandings();
			expect(formatCell(players[0] as any, 'points')).toBe('15');
		});

		it('formats points as dash when null', () => {
			const { formatCell } = makeStandings();
			const noPoints = createMockPlayer({ points: null });
			expect(formatCell(noPoints as any, 'points')).toBe('-');
		});

		it('formats deck name when available', () => {
			const { formatCell } = makeStandings();
			// deckName is now stored in gameData, not deckList
			const withDeck = createMockPlayer({
				gameData: { type: 'mtg', deckName: 'Mono Red', deckColors: 'R' },
			});
			expect(formatCell(withDeck as any, 'deck')).toBe('Mono Red');
		});

		it('formats deck as dash when no deck list', () => {
			const { formatCell } = makeStandings();
			expect(formatCell(players[0] as any, 'deck')).toBe('-');
		});
	});

	// ── Empty state ──

	describe('empty state', () => {
		it('isEmpty is true when no rows and not loading', () => {
			mockPlayerStore.players = [];
			const { isEmpty, loading: l } = makeStandings();
			l.value = false;
			expect(isEmpty.value).toBe(true);
		});

		it('isEmpty is false when loading', () => {
			mockPlayerStore.players = [];
			const { isEmpty, loading: l } = makeStandings();
			l.value = true;
			expect(isEmpty.value).toBe(false);
		});

		it('emptyMessage for watchlist without playerListId', () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = null;
			const { emptyMessage } = makeStandings();
			expect(emptyMessage.value).toBe('Select a player list in settings');
		});

		it('emptyMessage for watchlist with playerListId', () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 42;
			const { emptyMessage } = makeStandings();
			expect(emptyMessage.value).toBe('No players in this list');
		});

		it('emptyMessage for reveal with 0 revealed', () => {
			mutableConfig.viewMode = 'reveal';
			mutableConfig.revealedCount = 0;
			const { emptyMessage } = makeStandings();
			expect(emptyMessage.value).toBe('Waiting for reveal...');
		});

		it('emptyMessage defaults to generic message', () => {
			mutableConfig.viewMode = 'all';
			mockPlayerStore.players = [];
			const { emptyMessage } = makeStandings();
			expect(emptyMessage.value).toBe('No standings data available');
		});

		it('keeps existing standings visible while selected round snapshot refreshes empty', async () => {
			mutableConfig.roundId = 8;
			mockFetch.mockImplementation(async () => standingsRead({
				round: createMockRound({ id: 8, name: 'Round 8' }),
				roundStandings: [],
			}));

			const { isEmpty } = makeStandings();
			await nextTick();
			await nextTick();

			expect(isEmpty.value).toBe(false);
		});

		it('emptyMessage for selected round uses snapshot copy', () => {
			mutableConfig.roundId = 8;
			mockFetch.mockImplementation(async () => standingsRead({ roundStandings: [] }));
			const { emptyMessage } = makeStandings();
			expect(emptyMessage.value).toBe('No standings snapshot available for this round');
		});
	});

	// ── Data loading ──

	describe('loadStandings', () => {
		it('reads everything Standings renders from in one Screen Output read', async () => {
			makeStandings();
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(STANDINGS_READ, expect.anything());
			expect(mockPlayerStore.loadPlayersFrom).toHaveBeenCalledWith(1, expect.any(Function));
		});

		it('re-reads when the selected round changes', async () => {
			makeStandings();
			await flushPromises();

			mutableConfig.roundId = 3;
			await flushPromises();

			expect(mockFetch).toHaveBeenCalledTimes(2);
			expect(mockFetch).toHaveBeenLastCalledWith(STANDINGS_READ, expect.anything());
		});

		it('filters to the watchlist members the read answers', async () => {
			mutableConfig.viewMode = 'watchlist';
			mutableConfig.playerListId = 42;
			mockFetch.mockImplementation(async () => standingsRead({ watchlist: { name: 'VIPs', playerIds: [1, 3] } }));

			const { displayRows } = makeStandings();
			await flushPromises();

			expect(displayRows.value).toHaveLength(2);
			expect(displayRows.value.map((p: any) => p.name)).toEqual(['Alice', 'Charlie']);
		});

		it('does not read without an event', async () => {
			mockEventId.value = null;
			makeStandings();
			await flushPromises();

			expect(mockFetch).not.toHaveBeenCalled();
		});
	});

	// ── page rotation ──

	describe('page rotation', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('a non-interactive rendering projects the rotation from server time and never writes', async () => {
			// 10 players / rowsPerPage=3 = 4 pages; anchor 5s ago of 5s pages → page 2.
			mutableConfig.autoPageEnabled = true;
			mutableConfig.autoPageIntervalMs = 5000;
			mutableConfig.rowsPerPage = 3;
			mutableConfig.rotationAnchor = mockServerNow - 5000;
			mockInteractiveStandings.value = false;

			const { currentPage, pageData } = makeStandings();
			await nextTick();

			expect(currentPage.value).toBe(2);
			expect(pageData.value[0]!.name).toBe('Diana');

			// Crossing a flip boundary advances the projection — still no writes.
			mockServerNow += 5000;
			vi.advanceTimersByTime(5000);
			await nextTick();

			expect(currentPage.value).toBe(3);
			expect(mockScreenStore.updateModeConfig).not.toHaveBeenCalled();
		});

		it('an unsynced rendering holds the first page instead of projecting on an unknown clock', async () => {
			mutableConfig.autoPageEnabled = true;
			mutableConfig.autoPageIntervalMs = 5000;
			mutableConfig.rowsPerPage = 3;
			mutableConfig.rotationAnchor = mockServerNow - 15_000;
			mockIsSynced.value = false;

			const { currentPage } = makeStandings();
			await nextTick();

			expect(currentPage.value).toBe(1);
			expect(mockScreenStore.updateModeConfig).not.toHaveBeenCalled();
		});

		it('manual selection while rotating re-anchors instead of writing a page number', () => {
			mockInteractiveStandings.value = true;
			mutableConfig.autoPageEnabled = true;
			mutableConfig.autoPageIntervalMs = 5000;
			mutableConfig.rowsPerPage = 3;
			mutableConfig.rotationAnchor = mockServerNow;

			const { setPage } = makeStandings();
			setPage(3);

			expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
				1,
				1,
				'standings',
				{ rotationAnchor: mockServerNow - 2 * 5000 },
			);
		});
	});
});
