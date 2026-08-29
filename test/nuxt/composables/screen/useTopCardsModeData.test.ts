import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));
mockNuxtImport('$fetch', () => mockFetch);

const mockPlayerStore = {
	players: [{ id: 1 }, { id: 2 }],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
	dataVersion: 0,
};

const defaultConfig = {
	scope: 'all' as 'all' | 'topN' | 'playerList',
	topN: 8,
	playerListId: undefined as number | undefined,
	archetypeFilter: undefined as string | undefined,
	board: 'mainboard' as const,
	sortBy: 'inclusionRate' as const,
	limit: 10,
	excludedCardTypes: ['Land'] as string[],
	columns: 5,
	cardSize: 'medium' as const,
	dynamicCardSize: true,
	cardGap: 12,
	showHeader: true,
	headerText: undefined as string | undefined,
	showCardNames: true,
	showRankBadges: true,
	statBadge: 'inclusionRate' as const,
	statBadgeSize: 'medium' as const,
};

const mutableConfig = reactive({ ...defaultConfig });

mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useScreenContext', () => () => ({
	screen: ref({ id: 1, name: 'Test Screen' }),
	eventId: computed(() => 1),
	interactive: ref(false),
}));
mockNuxtImport('useScreenModeConfig', () => () => computed(() => mutableConfig));

describe('useTopCardsModeData', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		Object.assign(mutableConfig, defaultConfig, { excludedCardTypes: ['Land'] });
		mockFetch.mockResolvedValue({ entries: [], totalDecks: 0, scope: 'all' });
	});

	it('returns expected properties', () => {
		const result = useTopCardsModeData();

		expect(result).toHaveProperty('config');
		expect(result).toHaveProperty('loading');
		expect(result).toHaveProperty('error');
		expect(result).toHaveProperty('isEmpty');
		expect(result).toHaveProperty('emptyMessage');
		expect(result).toHaveProperty('headerText');
		expect(result).toHaveProperty('entries');
		expect(result).toHaveProperty('fetchData');
	});

	it('generates the default header text for the full field', () => {
		const { headerText } = useTopCardsModeData();

		expect(headerText.value).toBe('Most Played Cards');
	});

	it('prefixes the header with the Top N scope', () => {
		mutableConfig.scope = 'topN';
		mutableConfig.topN = 8;

		const { headerText } = useTopCardsModeData();

		expect(headerText.value).toBe('Top 8 Most Played Cards');
	});

	it('names the archetype filter in the header', () => {
		mutableConfig.archetypeFilter = 'Mono Red';

		const { headerText } = useTopCardsModeData();

		expect(headerText.value).toBe('Top Cards: Mono Red');
	});

	it('prefers custom header text', () => {
		mutableConfig.headerText = 'The Chase Cards';

		const { headerText } = useTopCardsModeData();

		expect(headerText.value).toBe('The Chase Cards');
	});

	it('fetches the cards endpoint with board, sort, limit, and joined excludeTypes', async () => {
		const { fetchData } = useTopCardsModeData();
		await fetchData();

		expect(mockFetch).toHaveBeenLastCalledWith(
			expect.stringContaining('/api/events/1/metagame/cards'),
			{
				query: expect.objectContaining({
					scope: 'all',
					board: 'mainboard',
					sortBy: 'inclusionRate',
					limit: 10,
					excludeTypes: 'Land',
				}),
			},
		);
	});

	it('omits excludeTypes when no card types are excluded', async () => {
		mutableConfig.excludedCardTypes = [];

		const { fetchData } = useTopCardsModeData();
		await fetchData();

		const query = mockFetch.mock.lastCall?.[1]?.query;
		expect(query).toBeDefined();
		expect(query).not.toHaveProperty('excludeTypes');
	});

	it('isEmpty is true when entries are empty and not loading', async () => {
		const { isEmpty, fetchData } = useTopCardsModeData();
		await fetchData();

		expect(isEmpty.value).toBe(true);
	});

	it('exposes fetched entries', async () => {
		mockFetch.mockResolvedValue({
			entries: [{ id: 1, name: 'Lightning Bolt', inclusionRate: 80, avgCopies: 3.6, totalCopies: 18, deckCount: 4, mainboardCount: 18, sideboardCount: 0, mainboardDeckCount: 4, sideboardDeckCount: 0, cardType: 'Instant', scryfallId: null, colors: 'R', cmc: 1, manaCost: '{R}' }],
			totalDecks: 5,
			scope: 'all',
		});

		const { entries, fetchData } = useTopCardsModeData();
		await fetchData();

		expect(entries.value).toHaveLength(1);
		expect(entries.value[0]!.name).toBe('Lightning Bolt');
	});

	it('emptyMessage references no players when store is empty', () => {
		const origPlayers = mockPlayerStore.players;
		const origLoaded = mockPlayerStore.isLoaded;
		mockPlayerStore.players = [];
		mockPlayerStore.isLoaded = false;

		const { emptyMessage } = useTopCardsModeData();

		expect(emptyMessage.value).toBe('No players in this event');

		mockPlayerStore.players = origPlayers;
		mockPlayerStore.isLoaded = origLoaded;
	});
});
