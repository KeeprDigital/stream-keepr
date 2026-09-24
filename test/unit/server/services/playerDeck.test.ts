import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

vi.mock('~~/server/db', () => ({ db: mockDb }));

const { playerDeckService } = await import('~~/server/services/playerDeck');

const primary = {
	id: 10,
	eventId: 1,
	playerId: 2,
	externalId: 'deck-10',
	externalSource: 'melee' as const,
	formatExternalId: 'modern',
	name: 'Modern Deck',
	colors: 'UR',
	sortOrder: 0,
	isPrimary: true,
	archetypeId: null,
	reviewedAt: null,
	createdAt: new Date(),
	updatedAt: new Date(),
};
const finals = {
	...primary,
	id: 20,
	externalId: 'deck-20',
	formatExternalId: 'standard',
	name: 'Standard Deck',
	sortOrder: 1,
	isPrimary: false,
};

describe('playerDeckService', () => {
	beforeEach(() => resetDbMocks());

	it('selects an explicit deck only when it belongs to the player', async () => {
		await expect(playerDeckService().selectFromDecks(1, [primary, finals], { deckId: 20 })).resolves.toEqual(finals);
		await expect(playerDeckService().selectFromDecks(1, [primary, finals], { deckId: 99 })).resolves.toBeNull();
	});

	it('selects the submitted deck matching the phase format', async () => {
		getChain('select').limit.mockResolvedValue([{ formatExternalId: 'standard' }]);

		const selected = await playerDeckService().selectFromDecks(1, [primary, finals], { phaseId: 5 });

		expect(selected).toEqual(finals);
	});

	it('resolves a round through its phase format and falls back to primary when no format deck exists', async () => {
		getChain('select').limit.mockResolvedValue([{ formatExternalId: 'pioneer' }]);

		const selected = await playerDeckService().selectFromDecks(1, [primary, finals], { roundId: 7 });

		expect(selected).toEqual(primary);
	});

	it('reconciles one player deck snapshot in a single atomic batch', async () => {
		getChain('select').where.mockResolvedValue([{
			playerId: 2,
			gameData: { type: 'mtg', deckName: 'Imported', deckColors: 'UR' },
			archetypeId: 5,
			reviewedAt: new Date('2026-07-15T00:00:00.000Z'),
			archetypeName: 'Control',
			archetypeColors: 'WU',
		}]);

		await playerDeckService().replaceMeleeDecksForEvent(1, [{ playerId: 2, snapshots: [{
			deck: {
				eventId: 1,
				playerId: 2,
				externalId: 'deck-10',
				formatExternalId: 'modern',
				name: 'Imported Modern',
				colors: 'UR',
				sortOrder: 0,
				isPrimary: true,
			},
			cards: [{ cardId: 7, quantity: 4, compartment: 'mainboard', sortOrder: 0 }],
			unresolvedCards: [{
				entryType: 'card',
				originalName: 'Unknown',
				normalizedOriginalName: 'unknown',
				setCode: null,
				normalizedSetCode: '',
				quantity: 1,
				compartment: 'sideboard',
				sortOrder: 1,
				cardType: null,
			}],
			importedCompanion: { action: 'set', cardId: 9 },
		}] }]);

		expect(mockDb.batch).toHaveBeenCalledOnce();
		expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(10);
		const deckUpsertConflict = getChain('insert').onConflictDoUpdate.mock.calls[0]![0];
		expect(deckUpsertConflict.set).not.toHaveProperty('archetypeId');
		expect(deckUpsertConflict.set).not.toHaveProperty('reviewedAt');
		expect(getChain('insert').onConflictDoUpdate.mock.calls[1]![0]).toEqual(expect.objectContaining({
			setWhere: expect.anything(),
		}));
		expect(getChain('update').set).toHaveBeenLastCalledWith(expect.objectContaining({
			updatedAt: expect.any(Date),
		}));
	});

	it('does not execute any deck mutation outside the atomic batch when it fails', async () => {
		getChain('select').where.mockResolvedValue([{
			playerId: 2,
			gameData: { type: 'mtg', deckName: null, deckColors: null },
			archetypeId: null,
			reviewedAt: null,
			archetypeName: null,
			archetypeColors: null,
		}]);
		mockDb.batch.mockRejectedValue(new Error('injected batch failure'));

		await expect(playerDeckService().replaceMeleeDecksForEvent(1, [{ playerId: 2, snapshots: [] }])).rejects.toThrow('injected batch failure');

		expect(mockDb.batch).toHaveBeenCalledOnce();
	});

	it('keeps an empty one-thousand-player replacement within a fixed three-statement batch', async () => {
		const replacements = Array.from({ length: 1000 }, (_, index) => ({
			playerId: index + 1,
			snapshots: [],
		}));
		getChain('select').where.mockResolvedValue(replacements.map(replacement => ({
			playerId: replacement.playerId,
			gameData: { type: 'mtg', deckName: 'Old', deckColors: 'R', customField: 'preserved' },
			archetypeId: null,
			reviewedAt: null,
			archetypeName: null,
			archetypeColors: null,
		})));

		await playerDeckService().replaceMeleeDecksForEvent(1, replacements);

		expect(mockDb.select).toHaveBeenCalledOnce();
		expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(3);
	});

	it('reviews a stable deck and projects its archetype when it is primary', async () => {
		const reviewedAt = new Date('2026-07-15T00:00:00.000Z');
		const reviewedDeck = { ...primary, archetypeId: 5, reviewedAt };
		const updatedPlayer = { id: 2, eventId: 1, archetypeId: 5 };
		const selectLimit = getChain('select').limit;
		selectLimit.mockResolvedValueOnce([primary]);
		selectLimit.mockResolvedValueOnce([{
			gameData: { type: 'mtg', deckName: 'Imported', deckColors: 'UR' },
			deckId: 10,
			archetypeId: 5,
			reviewedAt,
			importedName: 'Imported',
			importedColors: 'UR',
			archetypeName: 'Control',
			archetypeColors: 'WU',
		}]);
		const updateReturning = getChain('update').returning;
		updateReturning.mockResolvedValueOnce([reviewedDeck]);
		updateReturning.mockResolvedValueOnce([updatedPlayer]);

		const result = await playerDeckService().reviewDeck(1, 2, 10, 5);

		expect(result).toEqual({ deck: reviewedDeck, player: updatedPlayer });
		expect(getChain('update').set).toHaveBeenNthCalledWith(1, expect.objectContaining({
			archetypeId: 5,
			reviewedAt: expect.any(Date),
		}));
		expect(getChain('update').set).toHaveBeenNthCalledWith(2, expect.objectContaining({
			archetypeId: 5,
			gameData: expect.objectContaining({ deckName: 'Control', deckColors: 'WU' }),
		}));
	});

	it('does not overwrite a generic player edit when the primary deck is unreviewed', async () => {
		getChain('select').limit.mockResolvedValue([{
			gameData: { type: 'mtg', deckName: 'Manual', deckColors: 'G' },
			deckId: 10,
			archetypeId: null,
			reviewedAt: null,
			importedName: 'Imported',
			importedColors: 'R',
			archetypeName: null,
			archetypeColors: null,
		}]);

		await expect(playerDeckService().reconcilePrimaryArchetype(1, 2, { reviewedOnly: true })).resolves.toBeNull();
		expect(mockDb.update).not.toHaveBeenCalled();
	});
});
