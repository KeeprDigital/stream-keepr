import type { PlayerDeckCardEntry, PlayerDeckCollectionResponse, PlayerDeckResponse } from '~~/shared/types/metagame';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import { clearPlayerDeckCache, usePlayerDeckCache } from '~/composables/data/usePlayerDeckCache';

const mockFetch = vi.fn();
vi.stubGlobal('$fetch', mockFetch);

function card(overrides: Partial<PlayerDeckCardEntry> = {}): PlayerDeckCardEntry {
	return {
		cardId: 1,
		name: 'Test Card',
		scryfallId: null,
		cardType: 'Creature',
		colors: null,
		cmc: null,
		manaCost: null,
		deckCounterTypes: [],
		deckTokens: [],
		quantity: 1,
		compartment: 'mainboard',
		sortOrder: 0,
		highlanderPoints: null,
		...overrides,
	};
}

function deck(overrides: Partial<PlayerDeckResponse> = {}): PlayerDeckResponse {
	return {
		id: 10,
		playerId: 1,
		externalId: 'deck-10',
		formatExternalId: 'modern',
		phaseIds: [1],
		phaseName: 'Swiss',
		name: 'Main Deck',
		colors: 'UR',
		submittedName: 'Main Deck',
		submittedColors: 'UR',
		sortOrder: 0,
		isPrimary: true,
		archetypeId: null,
		reviewedAt: null,
		cards: [],
		companion: null,
		...overrides,
	};
}

function collection(decks: PlayerDeckResponse[] = [deck()], selectedDeckId = decks[0]?.id ?? null): PlayerDeckCollectionResponse {
	return { decks, selectedDeckId };
}

describe('usePlayerDeckCache', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		clearPlayerDeckCache();
	});

	it('fetches the deck collection and returns its selected deck', async () => {
		const response = collection([deck({ cards: [card({ name: 'Lightning Bolt', quantity: 4 })] })]);
		mockFetch.mockResolvedValueOnce(response);
		const player = createMockPlayer({ id: 1, updatedAt: new Date('2026-01-01') });

		const result = await usePlayerDeckCache().fetchDeck(player.id, 1, player.updatedAt);

		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/1/decks', { query: {} });
		expect(result).toEqual(response.decks[0]);
	});

	it('caches by player update timestamp and refetches after it changes', async () => {
		mockFetch.mockResolvedValue(collection());
		const cache = usePlayerDeckCache();

		await cache.fetchDeck(1, 1, new Date('2026-01-01'));
		await cache.fetchDeck(1, 1, new Date('2026-01-01'));
		await cache.fetchDeck(1, 1, new Date('2026-01-02'));

		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it('deduplicates concurrent collection requests', async () => {
		let resolveFetch!: (value: PlayerDeckCollectionResponse) => void;
		mockFetch.mockReturnValueOnce(new Promise<PlayerDeckCollectionResponse>((resolve) => {
			resolveFetch = resolve;
		}));
		const cache = usePlayerDeckCache();
		const updatedAt = new Date('2026-01-01');

		const first = cache.fetchDeck(1, 1, updatedAt);
		const second = cache.fetchDeck(1, 1, updatedAt);
		resolveFetch(collection());

		expect(await first).toEqual(deck());
		expect(await second).toEqual(deck());
		expect(mockFetch).toHaveBeenCalledOnce();
	});

	it('selects the deck whose format applies to a phase', async () => {
		const primary = deck({ id: 10, phaseIds: [1], isPrimary: true });
		const finals = deck({ id: 20, externalId: 'deck-20', phaseIds: [2], phaseName: 'Finals', isPrimary: false, sortOrder: 1 });
		mockFetch.mockResolvedValueOnce(collection([primary, finals], primary.id));

		const result = await usePlayerDeckCache().fetchDeck(1, 1, new Date('2026-01-01'), { phaseId: 2 });

		expect(result?.id).toBe(20);
		expect(mockFetch).toHaveBeenCalledWith('/api/events/1/players/1/decks', { query: { phaseId: 2 } });
	});

	it('clears cached collections', async () => {
		mockFetch.mockResolvedValue(collection());
		const cache = usePlayerDeckCache();
		const updatedAt = new Date('2026-01-01');
		await cache.fetchDeck(1, 1, updatedAt);

		clearPlayerDeckCache();

		expect(cache.getCachedDeck(1)).toBeNull();
		await cache.fetchDeck(1, 1, updatedAt);
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it('updates cached display details after review without replacing submitted deck content', async () => {
		const importedDeck = deck({ name: 'Imported Name', submittedName: 'Imported Name', cards: [card()] });
		mockFetch.mockResolvedValueOnce(collection([importedDeck]));
		const cache = usePlayerDeckCache();
		await cache.fetchDecks(1, 1, new Date('2026-01-01'));
		const reviewedAt = new Date('2026-07-15T00:00:00.000Z');
		mockFetch.mockResolvedValueOnce({
			deck: {
				...importedDeck,
				eventId: 1,
				externalSource: 'melee',
				name: 'Reviewed Control',
				colors: 'WU',
				archetypeId: 5,
				reviewedAt,
				createdAt: new Date(),
				updatedAt: reviewedAt,
			},
			player: null,
		});

		await cache.reviewDeck(1, 1, 10, 5);

		expect(mockFetch).toHaveBeenLastCalledWith('/api/events/1/players/1/decks/10/review', {
			method: 'PATCH',
			body: { archetypeId: 5 },
		});
		expect(cache.getCachedDeck(1)).toMatchObject({
			name: 'Reviewed Control',
			colors: 'WU',
			submittedName: 'Imported Name',
			cards: importedDeck.cards,
			archetypeId: 5,
			reviewedAt,
		});
	});

	it('builds every submitted deck list from normalized deck metadata', async () => {
		const highlander = { status: 'legal' as const, system: '7ph' as const, points: 1, maxPoints: 8, hasReserveListCards: false, pointedCards: [], duplicateCards: [], unknownCards: [] };
		const primary = deck({
			name: 'Control',
			colors: 'U',
			highlander,
			cards: [
				card({ cardType: 'Creature — Human', quantity: 4, manaCost: '{U}', cmc: 1 }),
				card({ cardId: 2, cardType: 'Instant', quantity: 3, manaCost: '{U}{U}', cmc: 2 }),
				card({ cardId: 3, cardType: 'Basic Land', quantity: 24 }),
				card({ cardId: 4, cardType: 'Instant', quantity: 2, compartment: 'sideboard' }),
			],
		});
		const finals = deck({ id: 20, externalId: 'deck-20', phaseIds: [2], name: 'Finals Deck', isPrimary: false, sortOrder: 1 });
		mockFetch.mockResolvedValueOnce(collection([primary, finals]));
		const cache = usePlayerDeckCache();
		const player = createMockPlayer({ id: 1 });
		await cache.fetchDecks(1, 1, player.updatedAt);

		const lists = cache.getDeckLists(player);

		expect(lists).toHaveLength(2);
		expect(lists[0]).toMatchObject({ deckId: 10, name: 'Control', colors: 'U', isPrimary: true });
		expect(lists[0]!.stats).toMatchObject({ creatures: 4, instants: 3, lands: 24 });
		expect(lists[0]!.pips?.U).toBe(10);
		expect(lists[0]!.curve).toMatchObject({ 1: 4, 2: 3 });
		expect(lists[0]!.highlander).toEqual(highlander);
	});
});
