import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deferred } from '~~/test/helpers/deferred';

const { mockFetch } = vi.hoisted(() => ({
	mockFetch: vi.fn(),
}));
mockNuxtImport('$fetch', () => mockFetch);

const mockReviewDeck = vi.fn();
const mockApplyArchetypeUpdated = vi.fn();
const mockApplyArchetypeDeleted = vi.fn();
const mockApplyReviewedDeck = vi.fn();
const mockClearCachedDeck = vi.fn();
const mockPlayerStore = reactive({ players: [] as any[] });
const mockMetagameStore = {
	applyRemoteInvalidated: vi.fn(),
};
const mockFeatureMatchStore = {
	loadFeatureMatchesByEventId: vi.fn(),
};

mockNuxtImport('useApiHeaders', () => () => ({
	getHeaders: () => ({}),
}));
mockNuxtImport('usePlayerDeckCache', () => () => ({
	reviewDeck: mockReviewDeck,
	applyArchetypeUpdated: mockApplyArchetypeUpdated,
	applyArchetypeDeleted: mockApplyArchetypeDeleted,
	applyReviewedDeck: mockApplyReviewedDeck,
	clearCachedDeck: mockClearCachedDeck,
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
		mockFetch.mockResolvedValue({
			decks: [importedDeck],
		});
		const store = usePlayerDeckStore();

		await store.loadByEventId(1);

		expect(store.decks).toEqual([importedDeck]);
		expect(store.isLoaded).toBe(true);
	});

	it('stores deck review state and updates the primary player projection', async () => {
		const reviewedDeck = deck({
			archetypeId: 5,
			reviewedAt: new Date(),
		});
		const player = { id: 2, archetypeId: null };
		mockPlayerStore.players = [player];
		mockReviewDeck.mockResolvedValue({
			deck: reviewedDeck,
			player: { id: 2, archetypeId: 5 },
		});
		const store = usePlayerDeckStore();
		store.decks = [
			deck(),
		] as any;

		await store.reviewDeck(1, 2, 10, 5);

		expect(store.decks[0]).toEqual(reviewedDeck);
		expect(player.archetypeId).toBe(5);
		expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).toHaveBeenCalledWith(1);
		expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
	});

	it('applies reviews received from another realtime client', () => {
		const store = usePlayerDeckStore();
		store.decks = [
			deck(),
		] as any;
		const reviewedDeck = deck({
			archetypeId: 5,
			reviewedAt: new Date(),
		});

		store.applyRemoteReviewed({ deck: reviewedDeck as any });

		expect(store.decks[0]).toEqual(reviewedDeck);
		expect(mockApplyReviewedDeck).toHaveBeenCalledWith(reviewedDeck);
	});

	it('drops the cached Deck Lists of every Player whose cards another client resolved, and only theirs (#648)', () => {
		const store = usePlayerDeckStore();
		const summaries = [
			deck(),
			deck({ id: 11, playerId: 3 }),
		];
		store.decks = structuredClone(summaries) as any;

		store.applyRemoteCardsResolved({
			deckIds: [10],
			playerIds: [2],
		});

		expect(mockClearCachedDeck).toHaveBeenCalledOnce();
		expect(mockClearCachedDeck).toHaveBeenCalledWith(2);
		// A resolved card changes no deck summary.
		expect(store.decks).toEqual(summaries);
	});

	it('applies archetype edits to every reviewed deck and its primary player projection', () => {
		const player = {
			id: 2,
			archetypeId: 5,
			gameData: { type: 'mtg', deckName: 'Old Name', deckColors: 'U' },
		};
		mockPlayerStore.players = [player];
		const store = usePlayerDeckStore();
		store.decks = [
			deck({
				archetypeId: 5,
				reviewedAt: new Date(),
				name: 'Old Name',
				colors: 'U',
			}),
		] as any;

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
		store.decks = [
			deck({
				archetypeId: 5,
				reviewedAt: new Date(),
				name: 'Reviewed Control',
				colors: 'WU',
			}),
		] as any;

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

	/**
	 * A Deck review is answered for the Event it was made in. Neither another Event nor
	 * the same Event loaded afresh since is the lifetime that answer belongs to, so it
	 * may not retag a Deck or Player there, invalidate its Metagame, or reload its
	 * Feature Match Slots (ADR-0024).
	 */
	describe.each([
		[
			'Event B',
			[2],
		],
		[
			'Event A, loaded again since',
			[2, 1],
		],
	])('a Deck review answered after the operator moved on to %s', (_, switches) => {
		it('changes nothing and follows up on nothing', async () => {
			const store = usePlayerDeckStore();
			store.decks = [
				deck(),
			] as any;
			const review = deferred<unknown>();
			mockReviewDeck.mockReturnValueOnce(review.promise);

			const reviewing = store.reviewDeck(1, 2, 10, 5);
			let shown!: ReturnType<typeof deck>[];
			for (const eventId of switches) {
				store.$reset();
				shown = [
					deck({ eventId, name: `Loaded for ${eventId}` }),
				];
				mockFetch.mockResolvedValueOnce({
					decks: structuredClone(shown),
				});
				await store.loadByEventId(eventId);
			}
			const player = { id: 2, archetypeId: null };
			mockPlayerStore.players = [player];
			review.resolve({
				deck: deck({
					archetypeId: 5,
					reviewedAt: new Date(),
				}),
				player: { id: 2, archetypeId: 5 },
			});
			await reviewing;

			expect(store.decks).toEqual(shown);
			expect(player.archetypeId).toBeNull();
			expect(mockMetagameStore.applyRemoteInvalidated).not.toHaveBeenCalled();
			expect(mockFeatureMatchStore.loadFeatureMatchesByEventId).not.toHaveBeenCalled();
		});
	});
});
