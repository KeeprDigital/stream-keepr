import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';

vi.mock('~~/server/db', () => ({ db: mockDb }));

const { eventCardNameOverrideService } = await import('~~/server/services/eventCardNameOverride');

describe('event card name override service', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	it('lists resolved overrides with nested card data', async () => {
		getChain('select').where.mockResolvedValue([
			{
				id: 1,
				eventId: 7,
				inputName: 'Bolt',
				normalizedInputName: 'bolt',
				inputSetCode: 'LEA',
				normalizedInputSetCode: 'lea',
				resolvedCardId: 99,
				createdAt: new Date('2026-01-01'),
				updatedAt: new Date('2026-01-02'),
				cardId: 99,
				cardName: 'Lightning Bolt',
				cardGame: 'mtg',
				cardScryfallId: 'scryfall-1',
				cardOracleId: 'oracle-1',
				cardType: 'Instant',
				cardColors: ['R'],
				cardCmc: 1,
				cardManaCost: '{R}',
				cardCreatedAt: new Date('2026-01-01'),
				cardUpdatedAt: new Date('2026-01-02'),
			},
		]);

		const result = await eventCardNameOverrideService().listResolvedByEvent(7);

		expect(result).toEqual([
			{
				id: 1,
				eventId: 7,
				inputName: 'Bolt',
				normalizedInputName: 'bolt',
				inputSetCode: 'LEA',
				normalizedInputSetCode: 'lea',
				resolvedCardId: 99,
				createdAt: new Date('2026-01-01'),
				updatedAt: new Date('2026-01-02'),
				card: {
					id: 99,
					name: 'Lightning Bolt',
					game: 'mtg',
					scryfallId: 'scryfall-1',
					oracleId: 'oracle-1',
					cardType: 'Instant',
					colors: ['R'],
					cmc: 1,
					manaCost: '{R}',
					createdAt: new Date('2026-01-01'),
					updatedAt: new Date('2026-01-02'),
				},
			},
		]);
	});
});
