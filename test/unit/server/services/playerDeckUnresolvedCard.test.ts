import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	playerDeckUnresolvedCards: {
		id: 'player_deck_unresolved_cards.id',
		deckId: 'player_deck_unresolved_cards.deck_id',
		entryType: 'player_deck_unresolved_cards.entry_type',
		originalName: 'player_deck_unresolved_cards.original_name',
		normalizedOriginalName: 'player_deck_unresolved_cards.normalized_original_name',
		setCode: 'player_deck_unresolved_cards.set_code',
		normalizedSetCode: 'player_deck_unresolved_cards.normalized_set_code',
		quantity: 'player_deck_unresolved_cards.quantity',
		compartment: 'player_deck_unresolved_cards.compartment',
		sortOrder: 'player_deck_unresolved_cards.sort_order',
		cardType: 'player_deck_unresolved_cards.card_type',
		createdAt: 'player_deck_unresolved_cards.created_at',
		updatedAt: 'player_deck_unresolved_cards.updated_at',
	},
	playerDecks: {
		id: 'player_decks.id',
		eventId: 'player_decks.event_id',
		playerId: 'player_decks.player_id',
		formatExternalId: 'player_decks.format_external_id',
		name: 'player_decks.name',
		sortOrder: 'player_decks.sort_order',
		archetypeId: 'player_decks.archetype_id',
		reviewedAt: 'player_decks.reviewed_at',
	},
	archetypes: {
		id: 'archetypes.id',
		name: 'archetypes.name',
	},
	players: { id: 'players.id', name: 'players.name' },
	phases: {
		id: 'phases.id',
		eventId: 'phases.event_id',
		name: 'phases.name',
		formatExternalId: 'phases.format_external_id',
		sortOrder: 'phases.sort_order',
	},
}));

const { playerDeckUnresolvedCardService } = await import('~~/server/services/playerDeckUnresolvedCard');

describe('playerDeckUnresolvedCardService', () => {
	beforeEach(() => resetDbMocks());

	it('lists unresolved rows with deck identity and derived phase name', async () => {
		const createdAt = new Date();
		const row = {
			id: 1,
			eventId: 1,
			playerId: 2,
			playerName: 'Marcus',
			deckId: 10,
			formatExternalId: 'modern',
			deckName: 'Burn',
			deckArchetypeId: null,
			reviewedAt: null,
			archetypeId: null,
			archetypeName: null,
			entryType: 'card' as const,
			originalName: 'Lightnng Bolt',
			setCode: null,
			quantity: 4,
			compartment: 'mainboard' as const,
			sortOrder: 0,
			cardType: 'Instant',
			createdAt,
			updatedAt: createdAt,
		};
		const orderBy = getChain('select').orderBy;
		orderBy.mockResolvedValueOnce([row]);
		orderBy.mockResolvedValueOnce([{ name: 'Swiss', formatExternalId: 'modern' }]);

		const result = await playerDeckUnresolvedCardService().listByEventId(1);

		expect(result).toEqual([{
			id: row.id,
			eventId: row.eventId,
			playerId: row.playerId,
			playerName: row.playerName,
			deckId: row.deckId,
			formatExternalId: row.formatExternalId,
			deckName: row.deckName,
			entryType: row.entryType,
			originalName: row.originalName,
			setCode: row.setCode,
			quantity: row.quantity,
			compartment: row.compartment,
			sortOrder: row.sortOrder,
			cardType: row.cardType,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			phaseName: 'Swiss',
		}]);
	});

	it('lists matching unresolved entries within the event-owned deck set', async () => {
		const rows = [{ id: 1 }, { id: 2 }];
		getChain('select').orderBy.mockResolvedValue(rows);

		const result = await playerDeckUnresolvedCardService().listMatchingEntries(1, 'lightnng bolt', 'm11', 'card');

		expect(result).toEqual(rows);
	});

	it('shows reviewed archetype names in sync diagnostics', async () => {
		const createdAt = new Date();
		const orderBy = getChain('select').orderBy;
		orderBy.mockResolvedValueOnce([{
			id: 1,
			eventId: 1,
			playerId: 2,
			playerName: 'Marcus',
			deckId: 10,
			formatExternalId: 'modern',
			deckName: 'Imported Burn',
			deckArchetypeId: 5,
			reviewedAt: createdAt,
			archetypeId: 5,
			archetypeName: 'Reviewed Control',
			entryType: 'card',
			originalName: 'Lightnng Bolt',
			setCode: null,
			quantity: 4,
			compartment: 'mainboard',
			sortOrder: 0,
			cardType: 'Instant',
			createdAt,
			updatedAt: createdAt,
		}]);
		orderBy.mockResolvedValueOnce([]);

		const [entry] = await playerDeckUnresolvedCardService().listByEventId(1);

		expect(entry?.deckName).toBe('Reviewed Control');
	});
});
