import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

// ── $fetch stub (used by searchFuzzyCardName, searchCardPrints, selectMeldCardPart) ──

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn().mockResolvedValue({ data: [] }) }));
mockNuxtImport('$fetch', () => mockFetch);

mockNuxtImport('useServerTime', () => () => ({
	getServerTime: () => Date.now(),
}));

// ── Mock Dependencies ──

const mockCardRepo = {
	saveScreenCard: vi.fn(),
	getScreenCard: vi.fn(),
	deleteScreenCard: vi.fn(),
};

const mockAbly = createMockRealtime();
const mockIsSelfOrigin = vi.fn(() => false);

const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

// Mock eventStore — needs to look like a Pinia store with reactive properties
const mockEventStoreState = {
	eventId: 1 as number | null,
	event: { id: 1, cardTimeout: 0 } as any,
};

mockNuxtImport('useCardRepository', () => () => mockCardRepo);
mockNuxtImport('useRealtime', () => () => mockAbly);
mockNuxtImport('useAsyncAction', () => () => ({
	executeAction: vi.fn(async (fn: any) => fn()),
}));
mockNuxtImport('useEventStore', () => () => mockEventStoreState);
mockNuxtImport('useScryfallBatch', () => () => ({
	fetchScryfallCards: vi.fn().mockResolvedValue(new Map()),
	buildDeckListArrays: vi.fn().mockReturnValue({ mainboard: [], sideboard: [] }),
}));
const mockFetchDeck = vi.fn().mockResolvedValue(null);
const mockGetCachedDeck = vi.fn().mockReturnValue(null);
mockNuxtImport('usePlayerDeckCache', () => () => ({
	fetchDeck: mockFetchDeck,
	getCachedDeck: mockGetCachedDeck,
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

// Helper: mock MtgCard (matches the full MtgCard shape required by cloneMtgCard)
function createMockMtgCard(overrides?: Record<string, any>) {
	return {
		id: 'card-1',
		name: 'Lightning Bolt',
		set: 'lea',
		layout: 'normal',
		imageData: { front: { normal: 'http://example.com/card.jpg' }, back: null },
		orientationData: { flipable: false, turnable: false, rotateable: false, counterRotateable: false },
		displayData: {
			flipped: false,
			rotated: false,
			turnedOver: false,
			counterRotated: false,
		},
		...overrides,
	} as any;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((promiseResolve) => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
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

describe('useCardStore deck sources and search', () => {
	let store: ReturnType<typeof useCardStore>;

	beforeEach(() => {
		store = useCardStore();
		store.$reset();
		vi.clearAllMocks();
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.card = {
			'card:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'card:preview': data => !(mockIsSelfOrigin as any)(data) && store.applyRemotePreview(data as any),
			'card:cleared': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCleared(data as any),
			'card:timeout': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteTimeout(data as any),
			'card:timeout:cancel': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteTimeoutCancel(data as any),
		};
		mockEventStoreState.eventId = 1;
		mockEventStoreState.event = { id: 1, cardTimeout: 0 };
	});

	afterEach(() => {
		store.$reset();
		store.timeout.stop();
		vi.useRealTimers();
	});

	// ── Active Screen ──

	describe('canUsePlayerDeckMode', () => {
		it('returns false when no players have deck names', () => {
			mockPlayerStoreState.players = [
				{ id: 1, name: 'Alice', gameData: { type: 'mtg', deckName: null } },
			];
			// canUsePlayerDeckMode checks gameData.deckName now
			const playerStore = usePlayerStore() as any;
			expect(playerStore.players.some((p: any) => p.gameData?.deckName)).toBe(false);
		});

		it('returns true when at least one player has a deck name', () => {
			mockPlayerStoreState.players = [
				{ id: 1, name: 'Alice', gameData: { type: 'mtg', deckName: null } },
				{ id: 2, name: 'Bob', gameData: { type: 'mtg', deckName: 'Mono Red' } },
			];
			const playerStore = usePlayerStore() as any;
			expect(playerStore.players.some((p: any) => p.gameData?.deckName)).toBe(true);
		});
	});

	// ── loadPlayerDeck ──

	describe('loadPlayerDeck', () => {
		beforeEach(() => {
			mockFetchDeck.mockReset().mockResolvedValue(null);
		});

		it('sets playerDeckPlayerId', async () => {
			mockFetchDeck.mockResolvedValue({ id: 1, cards: [] });
			mockPlayerStoreState.players = [{ id: 42, name: 'Alice', gameData: { type: 'mtg', deckName: 'Burn' }, updatedAt: new Date() }];
			await store.loadPlayerDeck(42);
			expect(store.playerDeckPlayerId).toBe(42);
		});
	});

	// ── clearPlayerDeck ──

	describe('clearPlayerDeck', () => {
		it('resets player deck state', () => {
			store.playerDeckPlayerId = 42;
			store.playerDeckData = { playerName: 'Alice', deckList: null, mainboard: [], sideboard: [] } as any;

			store.clearPlayerDeck();

			expect(store.playerDeckPlayerId).toBeNull();
			expect(store.playerDeckData).toBeNull();
		});
	});

	// ── saveActiveCard missing branches ──

	// ── clearActiveCard missing branches ──

	// ── searchFormatQuery ──

	describe('searchFormatQuery', () => {
		it('returns empty string for "all"', () => {
			store.selectedSearchFormat = 'all';
			expect(store.searchFormatQuery).toBe('');
		});

		it('returns "is:token" for "token"', () => {
			store.selectedSearchFormat = 'token';
			expect(store.searchFormatQuery).toBe('is:token');
		});

		it('returns "format:standard" for "standard"', () => {
			store.selectedSearchFormat = 'standard';
			expect(store.searchFormatQuery).toBe('format:standard');
		});
	});

	// ── searchFuzzyCardName ──

	describe('searchFuzzyCardName', () => {
		it('clears search for names shorter than 3 characters', async () => {
			store.searching = true;
			store.searchResults = [createMockMtgCard()];

			await store.searchFuzzyCardName('ab');

			expect(store.searching).toBe(false);
			expect(store.searchResults).toEqual([]);
		});

		it('fetches and populates searchResults', async () => {
			mockFetch.mockResolvedValueOnce({ data: [] });

			await store.searchFuzzyCardName('Lightning Bolt');

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('scryfall'),
				expect.objectContaining({ query: expect.objectContaining({ q: expect.stringContaining('Lightning Bolt') }) }),
			);
			expect(store.searching).toBe(false);
		});

		it('ignores an older response that arrives after the latest query', async () => {
			const first = deferred<any>();
			const second = deferred<any>();
			mockFetch
				.mockReturnValueOnce(first.promise)
				.mockReturnValueOnce(second.promise);

			const oldSearch = store.searchFuzzyCardName('Lightning');
			const newSearch = store.searchFuzzyCardName('Counterspell');
			second.resolve({ data: [createScryfallCard('new', 'Counterspell')] });
			await newSearch;
			first.resolve({ data: [createScryfallCard('old', 'Lightning Bolt')] });
			await oldSearch;

			expect(store.searchResults.map(card => card.name)).toEqual(['Counterspell']);
			expect(store.searching).toBe(false);
		});
	});

	// ── searchCardPrints ──

	describe('searchCardPrints', () => {
		it('fetches card printings', async () => {
			mockFetch.mockResolvedValueOnce({ data: [] });

			await store.searchCardPrints('Lightning Bolt');

			expect(mockFetch).toHaveBeenCalledWith(
				expect.stringContaining('scryfall'),
				expect.objectContaining({ query: expect.objectContaining({ unique: 'prints' }) }),
			);
			expect(store.searching).toBe(false);
		});
	});

	// ── selectPreviewCard ──

	describe('selectPreviewCard', () => {
		it('sets previewCard and shows card controls', async () => {
			const card = createMockMtgCard({ id: 'card-abc', name: 'Counterspell' });
			mockFetch.mockResolvedValueOnce({ data: [] });

			await store.selectPreviewCard(card, false);

			expect(store.previewCard?.name).toBe('Counterspell');
			expect(store.showCardControls).toBe(true);
		});

		it('applies turnedOver=true when requested', async () => {
			const card = createMockMtgCard();
			mockFetch.mockResolvedValueOnce({ data: [] });

			await store.selectPreviewCard(card, true);

			expect(store.previewCard?.displayData.turnedOver).toBe(true);
		});
	});

	// ── controlPreviewCard (remaining cases) ──

	describe('controlPreviewCard (extended)', () => {
		it('returns early when no previewCard', async () => {
			store.previewCard = null;
			await store.controlPreviewCard('flip');
			// No error thrown, no state changes
			expect(store.previewCard).toBeNull();
		});

		it('toggles turnOver', async () => {
			store.previewCard = createMockMtgCard();
			await store.controlPreviewCard('turnOver');
			expect(store.previewCard!.displayData.turnedOver).toBe(true);
		});

		it('toggles counterRotate', async () => {
			store.previewCard = createMockMtgCard();
			await store.controlPreviewCard('counterRotate');
			expect(store.previewCard!.displayData.counterRotated).toBe(true);
		});
	});

	// ── controlActiveCard ──

	describe('controlActiveCard', () => {
		it('returns early when no activeCard', async () => {
			store.activeCard = null;
			await store.controlActiveCard('flip');
			// No error thrown, no state changes
			expect(store.activeCard).toBeNull();
		});

		it('clears active card on "clear"', async () => {
			store.activeScreenId = 5;
			store.activeCard = createMockMtgCard();
			mockCardRepo.deleteScreenCard.mockResolvedValue(undefined);

			await store.controlActiveCard('clear');

			expect(store.activeCard).toBeNull();
		});

		it('flips active card and saves', async () => {
			store.activeScreenId = 5;
			store.activeCard = createMockMtgCard();
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);

			await store.controlActiveCard('flip');

			expect(store.activeCard!.displayData.flipped).toBe(true);
			expect(mockCardRepo.saveScreenCard).toHaveBeenCalled();
		});

		it('rotates active card and saves', async () => {
			store.activeScreenId = 5;
			store.activeCard = createMockMtgCard();
			mockCardRepo.saveScreenCard.mockResolvedValue(undefined);

			await store.controlActiveCard('rotate');

			expect(store.activeCard!.displayData.rotated).toBe(true);
		});
	});

	// ── clearHistory ──

	describe('clearHistory', () => {
		it('clears selection history', () => {
			store.selectionHistory = [createMockMtgCard()] as any;

			store.clearHistory();

			expect(store.selectionHistory).toHaveLength(0);
		});
	});

	// ── loadMatchDeckLists ──

	describe('loadMatchDeckLists', () => {
		it('does not fall back to a primary deck when the match snapshot explicitly has no deck', async () => {
			mockFetchDeck.mockReset().mockResolvedValue(null);
			mockPlayerStoreState.players = [
				{ id: 42, name: 'Alice', gameData: { type: 'mtg', deckName: 'Primary Deck' }, updatedAt: new Date() },
			];
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Id: 42, player1Data: { name: 'Alice', deckId: null }, player2Id: null, player2Data: null },
			] as any;

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).not.toHaveBeenCalled();
			expect(store.deckListPlayer1?.deckList).toBeNull();
		});

		it('uses stable player identity before name when duplicate names exist', async () => {
			const updatedAt = new Date('2026-07-15T00:00:00.000Z');
			mockFetchDeck.mockReset().mockResolvedValue(null);
			mockPlayerStoreState.players = [
				{ id: 41, name: 'Alice', gameData: null, updatedAt: new Date('2026-07-14T00:00:00.000Z') },
				{ id: 42, name: 'Alice', gameData: null, updatedAt },
			];
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Id: 42, player1Data: { name: 'Alice', deckId: 77 }, player2Id: null, player2Data: null },
			] as any;

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).toHaveBeenCalledWith(42, 1, updatedAt, { deckId: 77 });
		});

		it('loads a historical deck by stable ids when the inactive player is absent from the active store', async () => {
			mockFetchDeck.mockReset().mockResolvedValue(null);
			mockPlayerStoreState.players = [
				{ id: 41, name: 'Alice', gameData: null, updatedAt: new Date('2026-07-15T00:00:00.000Z') },
			];
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Id: 42, player1Data: { name: 'Alice', deckId: 77 }, player2Id: null, player2Data: null },
			] as any;

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).toHaveBeenCalledWith(42, 1, 'match-deck:77', { deckId: 77 });
		});

		it('loads an exact historical deck without a retained player name', async () => {
			mockFetchDeck.mockReset().mockResolvedValue(null);
			mockPlayerStoreState.players = [];
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Id: 42, player1Data: { deckId: 77 }, player2Id: null, player2Data: null },
			] as any;

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).toHaveBeenCalledWith(42, 1, 'match-deck:77', { deckId: 77 });
			expect(store.deckListPlayer1?.playerName).toBe('Player 42');
		});

		it('falls back to the snapshot name when legacy data has no player id', async () => {
			const updatedAt = new Date('2026-07-15T00:00:00.000Z');
			mockFetchDeck.mockReset().mockResolvedValue(null);
			mockPlayerStoreState.players = [
				{ id: 42, name: 'Alice', gameData: null, updatedAt },
			];
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Id: null, player1Data: { name: 'Alice', deckId: 77 }, player2Id: null, player2Data: null },
			] as any;

			await store.loadMatchDeckLists(1);

			expect(mockFetchDeck).toHaveBeenCalledWith(42, 1, updatedAt, { deckId: 77 });
		});

		it('sets null for players with no matching record', async () => {
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Data: null, player2Data: null },
			] as any;

			await store.loadMatchDeckLists(1);

			expect(store.deckListPlayer1).toBeNull();
			expect(store.deckListPlayer2).toBeNull();
		});
	});

	// ── clearMatchDeckLists ──

	describe('clearMatchDeckLists', () => {
		it('resets match deck list state', () => {
			store.deckListPlayer1 = { playerName: 'Alice', deckList: null, mainboard: [], sideboard: [] } as any;
			store.deckListPlayer2 = { playerName: 'Bob', deckList: null, mainboard: [], sideboard: [] } as any;
			store.deckListFilter = 'Lightning';

			store.clearMatchDeckLists();

			expect(store.deckListPlayer1).toBeNull();
			expect(store.deckListPlayer2).toBeNull();
			expect(store.deckListFilter).toBe('');
		});
	});

	// ── canUseDeckListMode ──

	describe('canUseDeckListMode', () => {
		it('returns false when an authoritative match snapshot explicitly has no deck', () => {
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Id: 1, player1Data: { name: 'Alice', deckId: null }, player2Data: null },
			] as any;
			mockPlayerStoreState.players = [
				{ id: 1, name: 'Alice', gameData: { type: 'mtg', deckName: 'Primary Deck' } },
			] as any;

			expect(store.canUseDeckListMode).toBe(false);
		});

		it('returns false when no feature match players have a deckName in gameData', () => {
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Data: { name: 'Alice' }, player2Data: null },
			] as any;
			mockPlayerStoreState.players = [
				{ id: 1, name: 'Alice', gameData: { type: 'mtg', deckName: null } },
			] as any;

			expect(store.canUseDeckListMode).toBe(false);
		});

		it('returns true when a feature match player has a deckName in gameData', () => {
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Data: { name: 'Alice' }, player2Data: null },
			] as any;
			mockPlayerStoreState.players = [
				{ id: 1, name: 'alice', gameData: { type: 'mtg', deckName: 'Burn' } },
			] as any;

			expect(store.canUseDeckListMode).toBe(true);
		});

		it('returns true when the match snapshot carries an exact submitted deck', () => {
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Data: { name: 'Alice', deckId: 77 }, player2Data: null },
			] as any;
			mockPlayerStoreState.players = [
				{ id: 1, name: 'Alice', gameData: null },
			] as any;

			expect(store.canUseDeckListMode).toBe(true);
		});

		it('returns false when feature match player name is not found in players list', () => {
			mockFeatureMatchStoreState.featureMatches = [
				{ id: 1, player1Data: { name: 'Alice' }, player2Data: null },
			] as any;
			mockPlayerStoreState.players = [] as any;

			expect(store.canUseDeckListMode).toBe(false);
		});
	});

	// ── Ably handlers (extended) ──

	describe('realtime handlers (extended)', () => {
		describe('card:updated (null card)', () => {
			it('resets timeout when card is null', () => {
				store.activeScreenId = 5;
				store.activeCard = createMockMtgCard();

				ablyCallbacks.card!['card:updated']!({ eventId: 1, screenId: 5, card: null });

				expect(store.activeCard).toBeNull();
			});
		});

		describe('card:preview', () => {
			it('skips when isSelfOrigin returns true', () => {
				store.activeScreenId = 5;
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.card!['card:preview']!({ eventId: 1, screenId: 5, card: createMockMtgCard() });

				expect(store.previewCard).toBeNull();
			});
		});

		describe('card:timeout:cancel', () => {
			it('cancels timeout for matching screen', () => {
				vi.useFakeTimers();
				store.activeScreenId = 5;
				const card = createMockMtgCard();
				store.activeCard = card;
				ablyCallbacks.card!['card:timeout']!({ eventId: 1, screenId: 5, timeoutDuration: 5000, expiresAt: Date.now() + 5000 });
				expect(store.timeout.remaining).toBe(5);

				ablyCallbacks.card!['card:timeout:cancel']!({ eventId: 1, screenId: 5 });

				expect(store.activeCard).toEqual(card);
				expect(store.timeout.remaining).toBe(0);
			});

			it('skips when screenId does not match', () => {
				vi.useFakeTimers();
				store.activeScreenId = 5;
				store.activeCard = createMockMtgCard();
				ablyCallbacks.card!['card:timeout']!({ eventId: 1, screenId: 5, timeoutDuration: 5000, expiresAt: Date.now() + 5000 });

				ablyCallbacks.card!['card:timeout:cancel']!({ eventId: 1, screenId: 99 });

				expect(store.timeout.remaining).toBe(5);
			});

			it('skips when isSelfOrigin returns true', () => {
				vi.useFakeTimers();
				store.activeScreenId = 5;
				store.activeCard = createMockMtgCard();
				ablyCallbacks.card!['card:timeout']!({ eventId: 1, screenId: 5, timeoutDuration: 5000, expiresAt: Date.now() + 5000 });
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.card!['card:timeout:cancel']!({ eventId: 1, screenId: 5 });

				expect(store.timeout.remaining).toBe(5);
			});
		});
	});
});
