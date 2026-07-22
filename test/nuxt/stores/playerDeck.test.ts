import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFetch = vi.fn();
vi.stubGlobal('$fetch', mockFetch);

const mockReviewDeck = vi.fn();
const mockApplyArchetypeUpdated = vi.fn();
const mockApplyArchetypeDeleted = vi.fn();
const mockApplyReviewedDeck = vi.fn();
const mockPlayerStore = reactive({ players: [] as any[] });
const mockMetagameStore = { applyRemoteInvalidated: vi.fn() };
const mockFeatureMatchStore = { loadFeatureMatchesByEventId: vi.fn() };

mockNuxtImport('useApiHeaders', () => () => ({ getHeaders: () => ({}) }));
mockNuxtImport('usePlayerDeckCache', () => () => ({
	reviewDeck: mockReviewDeck,
	applyArchetypeUpdated: mockApplyArchetypeUpdated,
	applyArchetypeDeleted: mockApplyArchetypeDeleted,
	applyReviewedDeck: mockApplyReviewedDeck,
}));
mockNuxtImport('usePlayerStore', () => () => mockPlayerStore);
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);
mockNuxtImport('useFeatureMatchStore', () => () => mockFeatureMatchStore);

function deck(overrides: Record<string, unknown> = {}) {
	return {
		id: 10,
		eventId: 1,
		playerId: 2,
		externalId: 'deck-10',
		externalSource: 'melee',
		formatExternalId: 'modern',
		name: 'Imported Deck',
		colors: 'UR',
		submittedName: 'Imported Deck',
		submittedColors: 'UR',
		sortOrder: 0,
		isPrimary: true,
		archetypeId: null,
		reviewedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

describe('usePlayerDeckStore', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPlayerStore.players = [];
		usePlayerDeckStore().$dispose();
		usePlayerDeckStore().$reset();
	});

	it('loads stable submitted deck summaries for the review queue', async () => {
		const importedDeck = deck();
		mockFetch.mockResolvedValue({ decks: [importedDeck] });
		const store = usePlayerDeckStore();

		await store.loadByEventId(1);

		expect(store.decks).toEqual([importedDeck]);
		expect(store.isLoaded).toBe(true);
	});

	it('stores deck review state and updates the primary player projection', async () => {
		const reviewedDeck = deck({ archetypeId: 5, reviewedAt: new Date() });
		const player = { id: 2, archetypeId: null };
		mockPlayerStore.players = [player];
		mockReviewDeck.mockResolvedValue({
			deck: reviewedDeck,
			player: { id: 2, archetypeId: 5 },
		});
		const store = usePlayerDeckStore();
		store.decks = [deck()] as any;

		await store.reviewDeck(1, 2, 10, 5);

		expect(store.decks[0]).toEqual(reviewedDeck);
		expect(player.archetypeId).toBe(5);
		expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
		expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
	});

	it('applies reviews received from another realtime client', () => {
		const store = usePlayerDeckStore();
		store.decks = [deck()] as any;
		const reviewedDeck = deck({ archetypeId: 5, reviewedAt: new Date() });

		store.applyRemoteReviewed({ deck: reviewedDeck as any });

		expect(store.decks[0]).toEqual(reviewedDeck);
		expect(mockApplyReviewedDeck).toHaveBeenCalledWith(reviewedDeck);
	});

	it('applies archetype edits to every reviewed deck and its primary player projection', () => {
		const player = {
			id: 2,
			archetypeId: 5,
			gameData: { type: 'mtg', deckName: 'Old Name', deckColors: 'U' },
		};
		mockPlayerStore.players = [player];
		const store = usePlayerDeckStore();
		store.decks = [deck({ archetypeId: 5, reviewedAt: new Date(), name: 'Old Name', colors: 'U' })] as any;

		store.applyArchetypeUpdated({ id: 5, name: 'Reviewed Control', colors: 'WU' } as any);

		expect(store.decks[0]).toMatchObject({ name: 'Reviewed Control', colors: 'WU' });
		expect(player).toMatchObject({
			archetypeId: 5,
			gameData: { type: 'mtg', deckName: 'Reviewed Control', deckColors: 'WU' },
		});
		expect(mockApplyArchetypeUpdated).toHaveBeenCalledOnce();
	});

	it('reverts deleted archetype reviews to submitted details everywhere', () => {
		const player = {
			id: 2,
			archetypeId: 5,
			gameData: { type: 'mtg', deckName: 'Reviewed Control', deckColors: 'WU' },
		};
		mockPlayerStore.players = [player];
		const store = usePlayerDeckStore();
		store.decks = [deck({ archetypeId: 5, reviewedAt: new Date(), name: 'Reviewed Control', colors: 'WU' })] as any;

		store.applyArchetypeDeleted(5);

		expect(store.decks[0]).toMatchObject({
			name: 'Imported Deck',
			colors: 'UR',
			archetypeId: null,
			reviewedAt: null,
		});
		expect(player).toMatchObject({
			archetypeId: null,
			gameData: { type: 'mtg', deckName: 'Imported Deck', deckColors: 'UR' },
		});
		expect(mockApplyArchetypeDeleted).toHaveBeenCalledWith(5);
	});
});
