import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

vi.mock('hub:db', () => ({ db: mockDb }));
vi.mock('~~/server/db/schema', () => ({
	playerDeckCards: {
		id: 'player_deck_cards.id',
		deckId: 'player_deck_cards.deck_id',
		cardId: 'player_deck_cards.card_id',
		quantity: 'player_deck_cards.quantity',
		compartment: 'player_deck_cards.compartment',
		sortOrder: 'player_deck_cards.sort_order',
	},
	playerDeckCompanions: {
		id: 'player_deck_companions.id',
		deckId: 'player_deck_companions.deck_id',
		companionCardId: 'player_deck_companions.companion_card_id',
		source: 'player_deck_companions.source',
	},
	cards: {
		id: 'cards.id',
		name: 'cards.name',
		scryfallId: 'cards.scryfallId',
		oracleId: 'cards.oracleId',
	},
}));

const { playerDeckCompanionService, validateImportedCompanionSnapshot } = await import('~~/server/services/playerDeckCompanion');

function createSelectChain() {
	const chain: Record<string, ReturnType<typeof vi.fn>> = {};
	chain.from = vi.fn().mockReturnValue(chain);
	chain.where = vi.fn().mockReturnValue(chain);
	chain.limit = vi.fn().mockResolvedValue([]);
	chain.leftJoin = vi.fn().mockReturnValue(chain);
	return chain;
}

describe('playerDeckCompanionService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	it('sets a manual companion when the sideboard has a spare slot', async () => {
		const sideboardStateChain = createSelectChain();
		sideboardStateChain!.where!.mockResolvedValueOnce([{ cardId: 10, quantity: 10 }]);

		const existingRowChain = createSelectChain();
		existingRowChain!.limit!.mockResolvedValueOnce([]);

		const companionSelectChain = createSelectChain();
		companionSelectChain!.limit!.mockResolvedValueOnce([
			{ source: 'manual', companionCardId: 99, name: 'Lutri, the Spellchaser', scryfallId: 'scryfall-lutri', oracleId: 'oracle-lutri' },
		]);

		const sideboardStateForReadChain = createSelectChain();
		sideboardStateForReadChain!.where!.mockResolvedValueOnce([{ cardId: 10, quantity: 10 }]);

		mockDb.select
			.mockReturnValueOnce(sideboardStateChain as never)
			.mockReturnValueOnce(existingRowChain as never)
			.mockReturnValueOnce(companionSelectChain as never)
			.mockReturnValueOnce(sideboardStateForReadChain as never);

		const companion = await playerDeckCompanionService().setManualCompanion(1, {
			id: 99,
			name: 'Lutri, the Spellchaser',
			game: 'mtg',
			scryfallId: 'scryfall-lutri',
			oracleId: 'oracle-lutri',
			cardType: 'Creature',
			colors: 'UR',
			cmc: 3,
			manaCost: '{1}{U/R}{U/R}',
			deckCounterTypes: [],
			deckTokens: [],
			createdAt: new Date(),
			updatedAt: new Date(),
		});

		expect(getChain('insert').values).toHaveBeenCalledWith(expect.objectContaining({
			deckId: 1,
			companionCardId: 99,
			source: 'manual',
		}));
		expect(companion).toEqual(expect.objectContaining({
			name: 'Lutri, the Spellchaser',
			source: 'manual',
			usesExistingSideboardSlot: false,
		}));
	});

	it('validates imported companions against the replacement snapshot', () => {
		const fullSideboard = [{
			cardId: 10,
			quantity: 15,
			compartment: 'sideboard' as const,
		}];

		expect(() => validateImportedCompanionSnapshot(fullSideboard, 99)).toThrow(
			'Imported companion requires an open sideboard slot or an existing sideboard copy.',
		);
		expect(() => validateImportedCompanionSnapshot(fullSideboard, 10)).not.toThrow();
	});
});
