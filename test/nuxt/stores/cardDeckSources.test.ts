import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn().mockResolvedValue({ data: [] }),
}));
mockNuxtImport('$fetch', () => mockFetch);

const mockCardRepo = {
	saveScreenCard: vi.fn(),
	getScreenCard: vi.fn(),
	deleteScreenCard: vi.fn(),
};

const mockEventStoreState = {
	eventId: 1 as number | null,
	event: { id: 1, cardTimeout: 0 } as any,
};

mockNuxtImport('useCardRepository', () => () => mockCardRepo);
mockNuxtImport('useEventStore', () => () => mockEventStoreState);
const mockFetchScryfallCards = vi.fn();
const mockBuildDeckListArrays = vi.fn();
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: mockFetchScryfallCards,
	buildDeckListArrays: mockBuildDeckListArrays,
}));
const mockFetchDeck = vi.fn().mockResolvedValue(null);
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: mockFetchDeck,
	getCachedDeck: vi.fn().mockReturnValue(null),
}));

const mockPlayerStoreState = reactive({
	players: [] as any[],
	isLoaded: true,
	loadPlayersByEventId: vi.fn(),
});
mockNuxtImport('usePlayerStore', () => () => mockPlayerStoreState);

const mockFeatureMatchStoreState = reactive({
	featureMatches: [] as any[],
	isLoaded: true,
	loadFeatureMatchesByEventId: vi.fn(),
});
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStoreState);

// The full MtgCard shape `cloneMtgCard` requires.
function createMockMtgCard(overrides?: Record<string, any>) {
	return {
		id: 'card-1',
		name: 'Lightning Bolt',
		set: 'lea',
		layout: 'normal',
		imageData: {
			front: { normal: 'http://example.com/card.jpg' },
			back: null,
		},
		orientationData: {
			flipable: false,
			turnable: false,
			rotateable: false,
			counterRotateable: false,
		},
		displayData: {
			flipped: false,
			rotated: false,
			turnedOver: false,
			counterRotated: false,
		},
		...overrides,
	} as any;
}

function createScryfallCard(id: string, name: string) {
	return {
		id,
		name,
		set_name: 'Test Set',
		layout: 'normal',
		image_uris: { normal: `https://example.com/${id}.jpg` },
	} as any;
}

function slotOf(player1Data: Record<string, unknown> | null, player1Id: number | null = null) {
	return [
		{
			id: 1,
			player1Id,
			player1Data,
			player2Id: null,
			player2Data: null,
		},
	] as any;
}

describe('useCardStore deck sources and search', () => {
	let store: ReturnType<typeof useCardStore>;

	beforeEach(() => {
		store = useCardStore();
		store.$reset();
		mockEventStoreState.eventId = 1;
		mockEventStoreState.event = { id: 1, cardTimeout: 0 };
		mockPlayerStoreState.players = [];
		mockFeatureMatchStoreState.featureMatches = [];
		mockFetchDeck.mockReset().mockResolvedValue(null);
		mockFetchScryfallCards.mockReset().mockResolvedValue({
			cards: new Map(),
			degraded: false,
		});
		mockBuildDeckListArrays.mockReset().mockReturnValue({ mainboard: [], sideboard: [] });
	});

	afterEach(() => {
		store.$reset();
		store.timeout.stop();
		vi.useRealTimers();
	});

	describe('canUsePlayerDeckMode', () => {
		it.each([
			[
				'no Player has a deck name',
				[null],
				false,
			],
			[
				'a Player has a deck name',
				[null, 'Mono Red'],
				true,
			],
		])('is %s → %s', (_, deckNames, usable) => {
			mockPlayerStoreState.players = deckNames.map((deckName, index) => ({
				id: index + 1,
				name: `Player ${index + 1}`,
				gameData: { type: 'mtg', deckName },
			}));

			expect(store.canUsePlayerDeckMode).toBe(usable);
		});
	});

	describe('search', () => {
		it.each([
			['all', ''],
			['token', 'is:token'],
			['standard', 'format:standard'],
		] as const)('narrows a search in format %s with %j', (format, query) => {
			store.selectedSearchFormat = format;

			expect(store.searchFormatQuery).toBe(query);
		});

		it('clears the results for a name shorter than 3 characters', async () => {
			store.searching = true;
			store.searchResults = [
				createMockMtgCard(),
			];

			await store.searchFuzzyCardName('ab');

			expect(store.searching).toBe(false);
			expect(store.searchResults).toEqual([]);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('keeps the latest query\'s results when an older one answers after it', async () => {
			const first = deferred<any>();
			const second = deferred<any>();
			mockFetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

			const oldSearch = store.searchFuzzyCardName('Lightning');
			const newSearch = store.searchFuzzyCardName('Counterspell');
			second.resolve({
				data: [
					createScryfallCard('new', 'Counterspell'),
				],
			});
			await newSearch;
			first.resolve({
				data: [
					createScryfallCard('old', 'Lightning Bolt'),
				],
			});
			await oldSearch;

			expect(store.searchResults.map(card => card.name)).toEqual(['Counterspell']);
			expect(store.searching).toBe(false);
		});

		it('asks Scryfall for every printing of a card', async () => {
			mockFetch.mockResolvedValueOnce({ data: [] });

			await store.searchCardPrints('Lightning Bolt');

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('scryfall'),
				expect.objectContaining({
					query: expect.objectContaining({ unique: 'prints' }),
				}),
			);
		});
	});

	describe('previewing and controlling a Card', () => {
		it('a selected Card previews with its controls, turned over when asked', async () => {
			mockFetch.mockResolvedValue({ data: [] });

			await store.selectPreviewCard(createMockMtgCard({ name: 'Counterspell' }), true);

			expect(store.previewCard?.name).toBe('Counterspell');
			expect(store.previewCard?.displayData.turnedOver).toBe(true);
			expect(store.showCardControls).toBe(true);
		});

		it.each([
			['flip', 'flipped'],
			['rotate', 'rotated'],
			['turnOver', 'turnedOver'],
			['counterRotate', 'counterRotated'],
		] as const)('%s toggles the preview\'s %s', async (action, field) => {
			store.previewCard = createMockMtgCard();

			await store.controlPreviewCard(action);

			expect(store.previewCard!.displayData[field]).toBe(true);
		});

		it.each([
			['flip', 'flipped'],
			['rotate', 'rotated'],
			['turnOver', 'turnedOver'],
			['counterRotate', 'counterRotated'],
		] as const)('%s toggles and saves the active Card\'s %s', async (action, field) => {
			store.activeScreenId = 5;
			store.activeCard = createMockMtgCard();
			mockCardRepo.saveScreenCard.mockResolvedValue({ success: true, revision: 1 });

			await store.controlActiveCard(action);

			expect(store.activeCard!.displayData[field]).toBe(true);
			expect(mockCardRepo.saveScreenCard).toHaveBeenCalledWith(1, 5, expect.objectContaining({
				displayData: expect.objectContaining({ [field]: true }),
			}));
		});

		it('controls nothing, and saves nothing, with no active Card', async () => {
			store.activeScreenId = 5;

			await store.controlActiveCard('flip');

			expect(store.activeCard).toBeNull();
			expect(mockCardRepo.saveScreenCard).not.toHaveBeenCalled();
		});

		it('"clear" clears the active Card', async () => {
			store.activeScreenId = 5;
			store.activeCard = createMockMtgCard();
			mockCardRepo.deleteScreenCard.mockResolvedValue({ success: true, revision: 1 });

			await store.controlActiveCard('clear');

			expect(store.activeCard).toBeNull();
		});
	});

	describe('loadMatchDeckLists', () => {
		it('loads no primary deck when the Match snapshot explicitly has no deck', async () => {
			mockPlayerStoreState.players = [
				{
					id: 42,
					name: 'Alice',
					gameData: { type: 'mtg', deckName: 'Primary Deck' },
					updatedAt: new Date(),
				},
			];
			mockFeatureMatchStoreState.featureMatches = slotOf({ name: 'Alice', deckId: null }, 42);

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).not.toHaveBeenCalled();
			expect(store.deckListPlayer1?.deckList).toBeNull();
		});

		it('identifies the Player by id before name when names collide', async () => {
			const updatedAt = new Date('2026-07-15T00:00:00.000Z');
			mockPlayerStoreState.players = [
				{
					id: 41,
					name: 'Alice',
					gameData: null,
					updatedAt: new Date('2026-07-14T00:00:00.000Z'),
				},
				{
					id: 42,
					name: 'Alice',
					gameData: null,
					updatedAt,
				},
			];
			mockFeatureMatchStoreState.featureMatches = slotOf({ name: 'Alice', deckId: 77 }, 42);

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).toHaveBeenCalledWith(42, 1, updatedAt, { deckId: 77 });
		});

		it('loads a historical deck by its ids when the Player is not in the active roster', async () => {
			mockPlayerStoreState.players = [
				{
					id: 41,
					name: 'Alice',
					gameData: null,
					updatedAt: new Date('2026-07-15T00:00:00.000Z'),
				},
			];
			mockFeatureMatchStoreState.featureMatches = slotOf({ name: 'Alice', deckId: 77 }, 42);

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).toHaveBeenCalledWith(42, 1, 'match-deck:77', { deckId: 77 });
		});

		it('names a historical deck\'s Player by id when the snapshot kept no name', async () => {
			mockFeatureMatchStoreState.featureMatches = slotOf({ deckId: 77 }, 42);

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).toHaveBeenCalledWith(42, 1, 'match-deck:77', { deckId: 77 });
			expect(store.deckListPlayer1?.playerName).toBe('Player 42');
		});

		it('falls back to the snapshot name when legacy data has no Player id', async () => {
			const updatedAt = new Date('2026-07-15T00:00:00.000Z');
			mockPlayerStoreState.players = [
				{
					id: 42,
					name: 'Alice',
					gameData: null,
					updatedAt,
				},
			];
			mockFeatureMatchStoreState.featureMatches = slotOf({ name: 'Alice', deckId: 77 });

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).toHaveBeenCalledWith(42, 1, updatedAt, { deckId: 77 });
		});

		it('holds no Deck List for a seat with no Player', async () => {
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Data: null, player2Data: null },
			] as any;

			await store.loadMatchDeckLists(1);

			expect(store.deckListPlayer1).toBeNull();
			expect(store.deckListPlayer2).toBeNull();
		});
	});

	describe('canUseDeckListMode', () => {
		it.each([
			[
				'the snapshot explicitly has no deck',
				{ name: 'Alice', deckId: null },
				'Primary Deck',
				false,
			],
			[
				'no Feature Match Player has a deck name',
				{ name: 'Alice' },
				null,
				false,
			],
			[
				'a Feature Match Player has a deck name, matched case-insensitively',
				{ name: 'Alice' },
				'Burn',
				true,
			],
			[
				'the snapshot carries an exact submitted deck',
				{ name: 'Alice', deckId: 77 },
				null,
				true,
			],
		])('when %s → %s', (_, player1Data, deckName, usable) => {
			mockFeatureMatchStoreState.featureMatches = slotOf(player1Data, 1);
			mockPlayerStoreState.players = [
				{
					id: 1,
					name: 'alice',
					gameData: deckName
						? { type: 'mtg', deckName }
						: null,
				},
			];

			expect(store.canUseDeckListMode).toBe(usable);
		});

		it('is false when the Feature Match Player is not in the roster', () => {
			mockFeatureMatchStoreState.featureMatches = [
				{
					id: 1,
					player1Data: { name: 'Alice' },
					player2Data: null,
				},
			] as any;

			expect(store.canUseDeckListMode).toBe(false);
		});
	});

	// Degraded card data (#471): placeholders stay up, and a slow cadence re-fetches until Scryfall answers.
	describe('degraded card data', () => {
		const degraded = {
			cards: new Map(),
			degraded: true,
		};
		const complete = {
			cards: new Map(),
			degraded: false,
		};

		function primeMatchup() {
			mockPlayerStoreState.players = [
				{
					id: 42,
					name: 'Alice',
					gameData: { type: 'mtg', deckName: 'Burn' },
					updatedAt: new Date('2026-08-20T00:00:00.000Z'),
				},
			];
			mockFeatureMatchStoreState.featureMatches = slotOf({ name: 'Alice', deckId: 77 }, 42);
		}

		beforeEach(() => {
			vi.useFakeTimers();
			primeMatchup();
			mockFetchDeck.mockResolvedValue({
				id: 77,
				externalId: 'deck-77',
				formatExternalId: 'modern',
				phaseIds: [1],
				phaseName: 'Swiss',
				name: 'Burn',
				colors: 'R',
				sortOrder: 0,
				isPrimary: true,
				companion: null,
				highlander: null,
				cards: [
					{
						name: 'Lightning Bolt',
						scryfallId: 'sc-1',
						quantity: 4,
						compartment: 'mainboard',
						cardType: 'Instant',
					},
				],
			});
		});

		it.each([
			[
				'matchup',
				(s: ReturnType<typeof useCardStore>) => s.loadMatchDeckLists(1),
				(s: ReturnType<typeof useCardStore>) => s.deckListPlayer1,
			],
			[
				'player deck',
				(s: ReturnType<typeof useCardStore>) => s.loadPlayerDeck(42),
				(s: ReturnType<typeof useCardStore>) => s.playerDeckData,
			],
		])('a degraded %s load keeps its rendering and recovers on the cadence without a reload', async (_, load, rendering) => {
			mockFetchScryfallCards.mockResolvedValueOnce(degraded).mockResolvedValue(complete);

			await load(store);
			expect(store.cardDataDegraded).toBe(true);
			expect(rendering(store)).not.toBeNull();

			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(store.cardDataDegraded).toBe(false);

			await vi.advanceTimersByTimeAsync(120_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
		});

		it('keeps the same rendering, with no loading flash, while a re-fetch is still degraded', async () => {
			mockFetchScryfallCards.mockResolvedValue(degraded);

			await store.loadMatchDeckLists(1);
			const rendered = store.deckListPlayer1;
			await vi.advanceTimersByTimeAsync(60_000);

			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
			expect(store.deckListPlayer1).toBe(rendered);
			expect(store.loadingDeckList).toBe(false);

			await vi.advanceTimersByTimeAsync(60_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(3);
		});

		it('keeps the cadence and the rendering when a re-fetch itself fails mid-outage', async () => {
			mockFetchScryfallCards.mockResolvedValueOnce(degraded).mockResolvedValue(complete);

			await store.loadMatchDeckLists(1);
			mockFetchDeck.mockRejectedValueOnce(new Error('network down'));
			await vi.advanceTimersByTimeAsync(60_000);

			expect(store.cardDataDegraded).toBe(true);
			expect(store.deckListPlayer1).not.toBeNull();

			await vi.advanceTimersByTimeAsync(60_000);
			expect(store.cardDataDegraded).toBe(false);
		});

		it.each([
			[
				'clearing the matchup',
				(s: ReturnType<typeof useCardStore>) => s.loadMatchDeckLists(1),
				(s: ReturnType<typeof useCardStore>) => s.clearMatchDeckLists(),
			],
			[
				'clearing the player deck',
				(s: ReturnType<typeof useCardStore>) => s.loadPlayerDeck(42),
				(s: ReturnType<typeof useCardStore>) => s.clearPlayerDeck(),
			],
		])('%s clears the degradation and stops the cadence', async (_, load, clear) => {
			mockFetchScryfallCards.mockResolvedValue(degraded);

			await load(store);
			clear(store);

			expect(store.cardDataDegraded).toBe(false);
			await vi.advanceTimersByTimeAsync(180_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(1);
		});

		it('a reset settles both surfaces', async () => {
			mockFetchScryfallCards.mockResolvedValue(degraded);

			await store.loadMatchDeckLists(1);
			await store.loadPlayerDeck(42);
			store.$reset();

			expect(store.cardDataDegraded).toBe(false);
			await vi.advanceTimersByTimeAsync(180_000);
			expect(mockFetchScryfallCards).toHaveBeenCalledTimes(2);
		});
	});
});
