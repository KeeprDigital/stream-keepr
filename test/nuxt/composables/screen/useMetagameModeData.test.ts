import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('$fetch', mockFetch);

const mockScreenStore = {
	updateModeConfig: vi.fn(),
};

const mockPlayerStore = {
	players: [{ id: 1 }, { id: 2 }],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
	dataVersion: 0,
};

const defaultConfig = {
	viewMode: 'archetype' as 'archetype' | 'cards',
	scope: 'all' as const,
	topN: 8,
	playerListId: undefined,
	archetypeFilter: undefined as string | undefined,
	sortBy: 'metaShare' as const,
	cardSortBy: 'inclusionRate' as const,
	archetypeColumns: [
		{ key: 'archetype', visible: true },
		{ key: 'count', visible: true },
		{ key: 'metaShare', visible: true },
		{ key: 'winRate', visible: true },
		{ key: 'avgPlace', visible: false },
		{ key: 'colors', visible: false },
	],
	cardColumns: [
		{ key: 'card', visible: true },
		{ key: 'manaCost', visible: true },
		{ key: 'type', visible: true },
		{ key: 'inclusionRate', visible: true },
		{ key: 'avgCopies', visible: true },
		{ key: 'totalCopies', visible: true },
		{ key: 'deckCount', visible: true },
		{ key: 'mainboardCount', visible: true },
		{ key: 'sideboardCount', visible: true },
	],
	limit: 50,
	pageSize: 5,
	autoPaging: false,
	autoPageIntervalMs: 10000,
	currentPage: 1,
	showHeader: true,
	headerText: undefined,
	animateEntries: true,
};

// Mutable config and interactive for timer tests
const mutableConfig = reactive({ ...defaultConfig });
const mockInteractive = ref(false);

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useScreenStore', () => () => mockScreenStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test Screen' }),
	eventId: computed(() => 1),
	interactive: mockInteractive,
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

describe('useMetagameModeData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.assign(mutableConfig, defaultConfig);
		mockInteractive.value = false;
		mockFetch.mockResolvedValue({ entries: [], totalPlayers: 0, scope: 'all' });
	});

	it('returns expected properties', () => {
		const result = useMetagameModeData();

		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('loading');
		expect(result).toHaveProperty('error');
		expect(result).toHaveProperty('isEmpty');
		expect(result).toHaveProperty('emptyMessage');
		expect(result).toHaveProperty('headerText');
		expect(result).toHaveProperty('displayRows');
		expect(result).toHaveProperty('pageData');
		expect(result).toHaveProperty('currentPage');
		expect(result).toHaveProperty('totalPages');
		expect(result).toHaveProperty('nextPage');
		expect(result).toHaveProperty('prevPage');
		expect(result).toHaveProperty('fetchData');
	});

	it('generates header text for archetype view with all scope', () => {
		const { headerText } = useMetagameModeData();

		expect(headerText.value).toBe('Full Field Metagame');
	});

	it('isEmpty is true when entries are empty and not loading', async () => {
		mockFetch.mockResolvedValue({ entries: [], totalPlayers: 0, scope: 'all' });

		const { isEmpty, fetchData } = useMetagameModeData();
		await fetchData();

		expect(isEmpty.value).toBe(true);
	});

	it('emptyMessage references no players when store is empty', () => {
		const origPlayers = mockPlayerStore.players;
		const origLoaded = mockPlayerStore.isLoaded;
		mockPlayerStore.players = [];
		mockPlayerStore.isLoaded = false;

		const { emptyMessage } = useMetagameModeData();

		expect(emptyMessage.value).toBe('No players in this event');

		// Restore
		mockPlayerStore.players = origPlayers;
		mockPlayerStore.isLoaded = origLoaded;
	});

	it('emptyMessage shows generic message when players exist but no data', () => {
		const { emptyMessage } = useMetagameModeData();

		expect(emptyMessage.value).toBe('No metagame data available');
	});

	it('totalPages computes from displayRows and pageSize', async () => {
		mockFetch.mockResolvedValue({
			entries: Array.from({ length: 12 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 })),
			totalPlayers: 12,
			scope: 'all',
		});

		const { totalPages, fetchData } = useMetagameModeData();
		await fetchData();

		// pageSize is 5 from config, 12 entries => ceil(12/5) = 3
		expect(totalPages.value).toBe(3);
	});

	it('pageData returns correct slice for current page', async () => {
		const entries = Array.from({ length: 8 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 }));
		mockFetch.mockResolvedValue({ entries, totalPlayers: 8, scope: 'all' });

		const { pageData, fetchData } = useMetagameModeData();
		await fetchData();

		// Page 1, pageSize 5 => first 5
		expect(pageData.value).toHaveLength(5);
		expect((pageData.value[0] as any).name).toBe('Arch0');
	});

	it('setPage calls screenStore.updateModeConfig', async () => {
		const entries = Array.from({ length: 12 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 }));
		mockFetch.mockResolvedValue({ entries, totalPlayers: 12, scope: 'all' });

		const { setPage, fetchData } = useMetagameModeData();
		await fetchData();
		setPage(2);

		expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
			1,
			1,
			'metagame',
			{ currentPage: 2 },
		);
	});

	it('setPage clamps to valid range', async () => {
		mockFetch.mockResolvedValue({
			entries: [{ name: 'A', count: 1, metaShare: 100 }],
			totalPlayers: 1,
			scope: 'all',
		});

		const { setPage, fetchData } = useMetagameModeData();
		await fetchData();

		// totalPages is 1, so setPage(5) should clamp to 1
		setPage(5);
		expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
			1,
			1,
			'metagame',
			{ currentPage: 1 },
		);
	});

	it('nextPage wraps to 1 after last page', async () => {
		mockFetch.mockResolvedValue({
			entries: [{ name: 'A', count: 1, metaShare: 100 }],
			totalPlayers: 1,
			scope: 'all',
		});

		const { nextPage, fetchData } = useMetagameModeData();
		await fetchData();

		// Only 1 page, currentPage=1, nextPage should wrap to 1
		nextPage();
		expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
			1,
			1,
			'metagame',
			{ currentPage: 1 },
		);
	});

	it('prevPage wraps to last page from page 1', async () => {
		const entries = Array.from({ length: 12 }, (_, i) => ({ name: `Arch${i}`, count: 1, metaShare: 1 }));
		mockFetch.mockResolvedValue({ entries, totalPlayers: 12, scope: 'all' });

		const { prevPage, fetchData } = useMetagameModeData();
		await fetchData();

		// currentPage=1, prevPage should go to last (3)
		prevPage();
		expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
			1,
			1,
			'metagame',
			{ currentPage: 3 },
		);
	});

	// ── auto-paging ──

	describe('auto-paging', () => {
		beforeEach(() => vi.useFakeTimers());
		afterEach(() => vi.useRealTimers());

		it('starts auto-paging when autoPaging=true, interactive=false, totalPages>1', async () => {
			const entries = Array.from({ length: 12 }, (_, i) => ({
				name: `Arch${i}`,
				count: 1,
				metaShare: 1,
			}));
			mockFetch.mockResolvedValue({ entries, totalPlayers: 12, scope: 'all' });
			mockInteractive.value = false;

			const { fetchData } = useMetagameModeData();
			await fetchData();

			// Enable auto-paging (triggers the watcher)
			mutableConfig.autoPaging = true;
			mutableConfig.autoPageIntervalMs = 5000;
			await nextTick();

			// Advance timer by one interval — should advance to page 2
			vi.advanceTimersByTime(5000);

			expect(mockScreenStore.updateModeConfig).toHaveBeenCalledWith(
				1,
				1,
				'metagame',
				{ currentPage: 2 },
			);
		});

		it('fetchData fetches cards endpoint with archetype filter when viewMode=cards', async () => {
			const cardEntries = [{ id: 1, name: 'Lightning Bolt', inclusionRate: 100, avgCopies: 4, totalCopies: 8, mainboardCount: 8, sideboardCount: 0, mainboardDeckCount: 2, sideboardDeckCount: 0, deckCount: 2, cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1 }];
			mockFetch.mockResolvedValue({ entries: cardEntries, totalDecks: 2, scope: 'all' });
			mutableConfig.viewMode = 'cards';
			mutableConfig.archetypeFilter = 'Mono Red';

			const { fetchData, displayRows } = useMetagameModeData();
			await fetchData();

			expect(displayRows.value).toHaveLength(1);
			expect(mockFetch).toHaveBeenLastCalledWith(
				expect.stringContaining('/metagame/cards'),
				{
					query: expect.objectContaining({ archetype: 'Mono Red' }),
				},
			);
		});
	});
});
