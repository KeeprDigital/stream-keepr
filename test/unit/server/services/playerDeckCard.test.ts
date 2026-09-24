import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

vi.mock('~~/server/db', () => ({ db: mockDb }));

const deckRow = {
	id: 10,
	eventId: 1,
	playerId: 2,
	externalId: 'deck-10',
	externalSource: 'melee',
	formatExternalId: 'modern',
	name: 'Burn',
	colors: 'R',
	sortOrder: 0,
	isPrimary: true,
	archetypeId: null,
	reviewedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};
const mockPlayerDeckService = {
	listByPlayer: vi.fn(),
	selectFromDecks: vi.fn(),
};
vi.mock('~~/server/services/playerDeck', () => ({
	playerDeckService: () => mockPlayerDeckService,
}));
const mockFindArchetypesByIds = vi.fn();
vi.mock('~~/server/services/archetype', () => ({
	archetypeService: () => ({ findManyByIds: mockFindArchetypesByIds }),
}));
const mockGetDeckCompanion = vi.fn();
vi.mock('~~/server/services/playerDeckCompanion', () => ({
	playerDeckCompanionService: () => ({ getDeckCompanion: mockGetDeckCompanion }),
}));
vi.mock('~~/server/db/schema', () => ({
	playerDeckCards: {
		id: 'player_deck_cards.id',
		deckId: 'player_deck_cards.deck_id',
		cardId: 'player_deck_cards.card_id',
		quantity: 'player_deck_cards.quantity',
		compartment: 'player_deck_cards.compartment',
		sortOrder: 'player_deck_cards.sort_order',
	},
	cards: {
		id: 'cards.id',
		name: 'cards.name',
		scryfallId: 'cards.scryfallId',
		oracleId: 'cards.oracleId',
		cardType: 'cards.cardType',
		colors: 'cards.colors',
		cmc: 'cards.cmc',
		manaCost: 'cards.manaCost',
		deckCounterTypes: 'cards.deckCounterTypes',
		deckTokens: 'cards.deckTokens',
	},
	phases: {
		id: 'phases.id',
		eventId: 'phases.eventId',
		name: 'phases.name',
		formatExternalId: 'phases.formatExternalId',
		sortOrder: 'phases.sortOrder',
	},
}));

const { playerDeckCardService } = await import('~~/server/services/playerDeckCard');

describe('playerDeckCardService', () => {
	beforeEach(() => {
		resetDbMocks();
		vi.clearAllMocks();
		mockPlayerDeckService.listByPlayer.mockResolvedValue([deckRow]);
		mockPlayerDeckService.selectFromDecks.mockResolvedValue(deckRow);
		mockGetDeckCompanion.mockResolvedValue(null);
		mockFindArchetypesByIds.mockResolvedValue([]);
	});

	it('returns normalized deck metadata, matching phases, cards, and selected identity', async () => {
		const orderBy = getChain('select').orderBy;
		orderBy.mockResolvedValueOnce([{
			deckId: 10,
			cardId: 1,
			name: 'Lightning Bolt',
			scryfallId: null,
			oracleId: 'oracle-bolt',
			cardType: 'Instant',
			colors: 'R',
			cmc: 1,
			manaCost: '{R}',
			deckCounterTypes: [],
			deckTokens: [],
			quantity: 4,
			compartment: 'mainboard',
			sortOrder: 0,
		}]);
		orderBy.mockResolvedValueOnce([{ id: 3, name: 'Swiss', formatExternalId: 'modern' }]);

		const result = await playerDeckCardService().getPlayerDecks(1, 2);

		expect(result.selectedDeckId).toBe(10);
		expect(result.decks[0]).toMatchObject({
			id: 10,
			externalId: 'deck-10',
			formatExternalId: 'modern',
			phaseIds: [3],
			phaseName: 'Swiss',
			name: 'Burn',
			colors: 'R',
			isPrimary: true,
		});
		expect(result.decks[0]!.cards[0]).toMatchObject({ name: 'Lightning Bolt', quantity: 4 });
	});

	it('uses reviewed archetype details while retaining submitted Melee metadata', async () => {
		const reviewedAt = new Date('2026-07-15T00:00:00.000Z');
		mockPlayerDeckService.listByPlayer.mockResolvedValue([{
			...deckRow,
			name: 'Imported Burn',
			colors: 'R',
			archetypeId: 5,
			reviewedAt,
		}]);
		mockFindArchetypesByIds.mockResolvedValue([{
			id: 5,
			eventId: 1,
			name: 'Jeskai Control',
			colors: 'WUR',
		}]);
		getChain('select').orderBy.mockResolvedValue([]);

		const result = await playerDeckCardService().getPlayerDecks(1, 2);

		expect(mockFindArchetypesByIds).toHaveBeenCalledWith(1, [5]);
		expect(result.decks[0]).toMatchObject({
			name: 'Jeskai Control',
			colors: 'WUR',
			submittedName: 'Imported Burn',
			submittedColors: 'R',
			archetypeId: 5,
			reviewedAt,
		});
	});

	it('returns an empty collection when the player has no decks', async () => {
		mockPlayerDeckService.listByPlayer.mockResolvedValue([]);

		await expect(playerDeckCardService().getPlayerDecks(1, 2)).resolves.toEqual({
			decks: [],
			selectedDeckId: null,
		});
	});
});
