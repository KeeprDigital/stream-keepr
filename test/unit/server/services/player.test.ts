import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockPlayer } from '~~/test/helpers/fixtures';

vi.mock('hub:db', () => ({ db: mockDb }));

const { playerService } = await import('~~/server/services/player');

describe('playerService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findById', () => {
		it('returns player when found', async () => {
			const player = createMockPlayer();
			mockDb.query.players.findFirst.mockResolvedValue(player);

			const result = await playerService().findById(1, 1);

			expect(result).toEqual(player);
			expect(mockDb.query.players.findFirst).toHaveBeenCalledOnce();
		});
	});

	describe('findAll', () => {
		it('returns players for event', async () => {
			const players = [createMockPlayer(), createMockPlayer({ id: 2 })];
			getChain('select').orderBy.mockResolvedValue(players);

			const result = await playerService().findAll({ eventId: 1 });

			expect(result).toEqual(players);
		});

		it('returns players filtered by listId using innerJoin', async () => {
			const players = [createMockPlayer()];
			getChain('select').orderBy.mockResolvedValue(players);

			const result = await playerService().findAll({ eventId: 1, listId: 5 });

			expect(result).toEqual(players);
			expect(getChain('select').innerJoin).toHaveBeenCalledTimes(2);
		});
	});

	describe('create', () => {
		it('returns created player', async () => {
			const newPlayer = createMockPlayer({ name: 'New Player' });
			getChain('insert').returning.mockResolvedValue([newPlayer]);

			const result = await playerService().create(1, { name: 'New Player' } as any);

			expect(result).toEqual(newPlayer);
		});

		it('strips forged Melee provenance before inserting', async () => {
			getChain('insert').returning.mockResolvedValue([createMockPlayer()]);

			await playerService().create(7, {
				name: 'Forger',
				externalId: 'forged-id',
				externalSource: 'melee',
				isActive: false,
			} as any);

			expect(getChain('insert').values).toHaveBeenCalledWith({ name: 'Forger', eventId: 7 });
		});
	});

	describe('update', () => {
		it('returns updated player', async () => {
			const updated = createMockPlayer({ name: 'Updated' });
			getChain('update').returning.mockResolvedValue([updated]);

			const result = await playerService().update(1, 1, { name: 'Updated' } as any);

			expect(result).toEqual(updated);
		});

		it('strips forged Melee provenance before writing', async () => {
			getChain('update').returning.mockResolvedValue([createMockPlayer()]);

			await playerService().update(1, 1, {
				name: 'Forger',
				externalId: 'forged-id',
				externalSource: 'melee',
				externalStatus: 2,
				isActive: false,
				lastSeenAt: new Date(0),
			} as any);

			expect(getChain('update').set).toHaveBeenCalledWith({ name: 'Forger' });
		});
	});

	describe('remove', () => {
		it('returns true when deleted', async () => {
			getChain('delete').returning.mockResolvedValue([createMockPlayer()]);

			const result = await playerService().remove(1, 1);

			expect(result).toBe(true);
		});

		it('returns false when not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await playerService().remove(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('batchUpsertByExternalId', () => {
		it('batch upserts multiple players', async () => {
			const now = new Date();
			const p1 = createMockPlayer({ id: 1, externalId: 'e1', externalSource: 'melee', createdAt: now, updatedAt: now });
			const p2 = createMockPlayer({ id: 2, externalId: 'e2', externalSource: 'melee', createdAt: now, updatedAt: new Date(now.getTime() + 1000) });
			mockDb.batch.mockResolvedValue([
				[{ eventId: 1, externalId: 'e2', externalSource: 'melee' }],
				[p1, p2],
			]);

			const result = await playerService().batchUpsertByExternalId([
				{ eventId: 1, name: 'P1', externalId: 'e1', externalSource: 'melee' } as any,
				{ eventId: 1, name: 'P2', externalId: 'e2', externalSource: 'melee' } as any,
			]);

			expect(result.players).toHaveLength(2);
			expect(result.created).toBe(1); // p1 createdAt === updatedAt
			expect(result.updated).toBe(1); // p2 createdAt !== updatedAt
			expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(2);
		});
	});

	describe('reconcileMeleeSnapshot', () => {
		it('atomically upserts returned players and deactivates missing active players', async () => {
			const seenAt = new Date('2026-07-15T08:00:00.000Z');
			const createdAt = new Date('2026-07-15T07:00:00.000Z');
			const activePlayer = createMockPlayer({
				id: 1,
				externalId: 'team-1',
				externalSource: 'melee',
				externalStatus: 7,
				isActive: true,
				lastSeenAt: seenAt,
				createdAt,
				updatedAt: seenAt,
			});
			mockDb.batch.mockResolvedValue([
				[{ eventId: 1, externalId: 'team-1', externalSource: 'melee' }],
				[activePlayer],
				[{ id: 9 }],
			]);

			const result = await playerService().reconcileMeleeSnapshot(1, [{
				externalId: 'team-1',
				externalStatus: 7,
				name: 'Active Player',
			}], seenAt);

			expect(result).toEqual({
				players: [activePlayer],
				created: 0,
				updated: 1,
				deactivated: 1,
			});
			expect(getChain('insert').select).toHaveBeenCalledOnce();
			expect(getChain('update').set).toHaveBeenCalledWith({
				isActive: false,
				updatedAt: seenAt,
			});
			expect(mockDb.batch).toHaveBeenCalledOnce();
		});

		it('deactivates all existing Melee players for a complete empty snapshot', async () => {
			mockDb.batch.mockResolvedValue([[{ id: 4 }, { id: 5 }]]);

			const result = await playerService().reconcileMeleeSnapshot(
				1,
				[],
				new Date('2026-07-15T08:00:00.000Z'),
			);

			expect(result).toMatchObject({
				players: [],
				created: 0,
				updated: 0,
				deactivated: 2,
			});
			expect(mockDb.insert).not.toHaveBeenCalled();
			expect(mockDb.update).toHaveBeenCalledOnce();
		});

		it('reactivates a returning Melee player and refreshes its lifecycle fields', async () => {
			const seenAt = new Date('2026-07-15T09:00:00.000Z');
			const returningPlayer = createMockPlayer({
				id: 4,
				externalId: 'returning-player',
				externalSource: 'melee',
				externalStatus: 9,
				isActive: true,
				lastSeenAt: seenAt,
				createdAt: new Date('2026-07-01T00:00:00.000Z'),
				updatedAt: seenAt,
			});
			mockDb.batch.mockResolvedValue([
				[{ eventId: 1, externalId: 'returning-player', externalSource: 'melee' }],
				[returningPlayer],
				[],
			]);

			const result = await playerService().reconcileMeleeSnapshot(1, [{
				externalId: 'returning-player',
				externalStatus: 9,
				name: 'Returning Player',
			}], seenAt);

			expect(result).toEqual({
				players: [returningPlayer],
				created: 0,
				updated: 1,
				deactivated: 0,
			});
			expect(getChain('insert').onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({
				set: expect.objectContaining({ updatedAt: seenAt }),
			}));
		});

		it('surfaces a snapshot batch failure without partial fallback writes', async () => {
			mockDb.batch.mockRejectedValue(new Error('player snapshot rolled back'));

			await expect(playerService().reconcileMeleeSnapshot(1, [{
				externalId: 'team-1',
				externalStatus: null,
				name: 'Player One',
			}], new Date('2026-07-15T09:00:00.000Z'))).rejects.toThrow('player snapshot rolled back');

			expect(mockDb.batch).toHaveBeenCalledOnce();
		});

		it('rejects duplicate external identities before persistence', async () => {
			await expect(playerService().reconcileMeleeSnapshot(1, [
				{ externalId: 'duplicate', externalStatus: null, name: 'One' },
				{ externalId: 'duplicate', externalStatus: null, name: 'Two' },
			])).rejects.toThrow('Duplicate Melee player external identity');

			expect(mockDb.batch).not.toHaveBeenCalled();
		});

		it('reconciles one thousand players with three atomic statements', async () => {
			const seenAt = new Date('2026-07-15T09:00:00.000Z');
			const inputs = Array.from({ length: 1000 }, (_, index) => ({
				externalId: `player-${index}`,
				externalStatus: null,
				name: `Player ${index}`,
			}));
			const persisted = inputs.map((input, index) => createMockPlayer({
				id: index + 1,
				externalId: input.externalId,
				externalSource: 'melee',
				createdAt: seenAt,
				updatedAt: seenAt,
			}));
			mockDb.batch.mockResolvedValue([[], persisted, []]);

			const result = await playerService().reconcileMeleeSnapshot(1, inputs, seenAt);

			expect(mockDb.batch.mock.calls[0]![0]).toHaveLength(3);
			expect(result).toMatchObject({ created: 1000, updated: 0, deactivated: 0 });
			expect(result.players).toHaveLength(1000);
		});
	});
});
