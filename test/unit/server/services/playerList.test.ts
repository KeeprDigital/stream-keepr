import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getChain, mockDb, resetDbMocks } from '~~/test/helpers/db-mock';
import { createMockPlayerList } from '~~/test/helpers/fixtures';

vi.mock('hub:db', () => ({ db: mockDb }));

// createError is auto-imported in Nitro
vi.stubGlobal('createError', (opts: any) => {
	const err = new Error(opts.message) as any;
	err.statusCode = opts.statusCode;
	return err;
});

const { playerListService } = await import('~~/server/services/playerList');

const SELECT_CHAIN_METHODS = ['from', 'where', 'limit', 'orderBy', 'innerJoin', 'leftJoin', 'groupBy'] as const;

function createSelectChain() {
	const chain = {} as Record<typeof SELECT_CHAIN_METHODS[number], ReturnType<typeof vi.fn>>;
	for (const method of SELECT_CHAIN_METHODS) {
		chain[method] = vi.fn().mockReturnValue(chain);
	}
	chain.limit = vi.fn().mockResolvedValue([]);
	chain.where = vi.fn().mockReturnValue(chain);
	chain.orderBy = vi.fn().mockResolvedValue([]);
	return chain;
}

describe('playerListService', () => {
	beforeEach(() => {
		resetDbMocks();
	});

	describe('findByEventId', () => {
		it('returns lists with member counts', async () => {
			const lists = [{ ...createMockPlayerList(), memberCount: 3 }];
			getChain('select').orderBy.mockResolvedValue(lists);

			const result = await playerListService().findByEventId(1);

			expect(result).toEqual(lists);
			expect(getChain('select').leftJoin).toHaveBeenCalledTimes(2);
			expect(getChain('select').groupBy).toHaveBeenCalledOnce();
		});
	});

	describe('findById', () => {
		it('returns list when found', async () => {
			const list = createMockPlayerList();
			getChain('select').limit.mockResolvedValue([list]);

			const result = await playerListService().findById(1, 1);

			expect(result).toEqual(list);
		});
	});

	describe('findByIdWithMembers', () => {
		it('returns list with member players joined', async () => {
			const list = createMockPlayerList({ id: 1, name: 'Top 8' });
			const members = [
				{ id: 10, name: 'Alice', eventId: 1 },
				{ id: 20, name: 'Bob', eventId: 1 },
			];
			// First call: findById in findByIdWithMembers; second call: getMembers validates list ownership.
			getChain('select').limit.mockResolvedValueOnce([list]).mockResolvedValueOnce([list]);
			// Member query uses orderBy as terminal.
			getChain('select').orderBy.mockResolvedValueOnce(members);

			const result = await playerListService().findByIdWithMembers(1, 1);

			expect(result).toBeDefined();
			expect(result?.id).toBe(1);
			expect(result?.name).toBe('Top 8');
			expect(result?.members).toEqual(members);
		});
	});

	describe('create', () => {
		it('returns created list', async () => {
			const newList = createMockPlayerList({ name: 'New List' });
			getChain('insert').returning.mockResolvedValue([newList]);

			const result = await playerListService().create(1, { name: 'New List' });

			expect(result).toEqual(newList);
		});
	});

	describe('update', () => {
		it('returns updated list', async () => {
			const updated = createMockPlayerList({ name: 'Updated' });
			getChain('update').returning.mockResolvedValue([updated]);

			const result = await playerListService().update(1, 1, { name: 'Updated' });

			expect(result).toEqual(updated);
		});
	});

	describe('remove', () => {
		it('returns true when deleted', async () => {
			getChain('delete').returning.mockResolvedValue([createMockPlayerList()]);

			const result = await playerListService().remove(1, 1);

			expect(result).toBe(true);
		});

		it('returns false when not found', async () => {
			getChain('delete').returning.mockResolvedValue([]);

			const result = await playerListService().remove(999, 1);

			expect(result).toBe(false);
		});
	});

	describe('addMembers', () => {
		it('adds members with correct sortOrder starting after existing max', async () => {
			const list = createMockPlayerList();
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([list]);
			const validationChain = createSelectChain();
			validationChain.where.mockResolvedValueOnce([{ id: 5 }, { id: 6 }]);
			const maxChain = createSelectChain();
			maxChain.where.mockResolvedValueOnce([{ maxOrder: 2 }]);
			mockDb.select
				.mockReset()
				.mockReturnValueOnce(listChain)
				.mockReturnValueOnce(validationChain)
				.mockReturnValueOnce(maxChain);
			// The JSON expansion inserts all rows with one bound payload.
			mockDb.batch.mockResolvedValue([
				[
					{ id: 10, listId: 1, playerId: 5, sortOrder: 3 },
					{ id: 11, listId: 1, playerId: 6, sortOrder: 4 },
				],
			]);

			const result = await playerListService().addMembers(1, 1, [5, 6]);

			expect(result).toEqual({ added: 2 });
			expect(mockDb.batch).toHaveBeenCalledOnce();
			expect(mockDb.batch.mock.calls[0]?.[0]).toHaveLength(1);
			expect(getChain('insert').select).toHaveBeenCalledOnce();
			expect(getChain('insert').values).not.toHaveBeenCalled();
		});

		it('validates and inserts the 500-ID API maximum without exhausting D1 bindings', async () => {
			const playerIds = Array.from({ length: 500 }, (_, index) => index + 1);
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([createMockPlayerList()]);
			const validationChain = createSelectChain();
			validationChain.where.mockResolvedValueOnce(playerIds.map(id => ({ id })));
			const maxChain = createSelectChain();
			maxChain.where.mockResolvedValueOnce([{ maxOrder: null }]);
			mockDb.select
				.mockReset()
				.mockReturnValueOnce(listChain)
				.mockReturnValueOnce(validationChain)
				.mockReturnValueOnce(maxChain);
			mockDb.batch.mockResolvedValueOnce([playerIds.map((playerId, sortOrder) => ({
				id: sortOrder + 1,
				listId: 1,
				playerId,
				sortOrder,
			}))]);

			const result = await playerListService().addMembers(1, 1, playerIds);

			expect(result).toEqual({ added: 500 });
			expect(mockDb.select).toHaveBeenCalledTimes(3);
			expect(mockDb.batch.mock.calls[0]?.[0]).toHaveLength(1);
			expect(getChain('insert').select).toHaveBeenCalledOnce();
		});

		it('starts sortOrder at 0 when no existing members', async () => {
			const list = createMockPlayerList();
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([list]);
			const validationChain = createSelectChain();
			validationChain.where.mockResolvedValueOnce([{ id: 5 }]);
			const maxChain = createSelectChain();
			maxChain.where.mockResolvedValueOnce([{ maxOrder: null }]);
			mockDb.select
				.mockReset()
				.mockReturnValueOnce(listChain)
				.mockReturnValueOnce(validationChain)
				.mockReturnValueOnce(maxChain);
			mockDb.batch.mockResolvedValue([
				[{ id: 10, listId: 1, playerId: 5, sortOrder: 0 }],
			]);

			const result = await playerListService().addMembers(1, 1, [5]);

			expect(result).toEqual({ added: 1 });
		});
	});

	describe('removeMember', () => {
		it('deletes member and returns true', async () => {
			const list = createMockPlayerList();
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([list]);
			const validationChain = createSelectChain();
			validationChain.where.mockResolvedValueOnce([{ id: 5 }]);
			mockDb.select.mockReset().mockReturnValueOnce(listChain).mockReturnValueOnce(validationChain);
			getChain('delete').returning.mockResolvedValue([{ id: 1, listId: 1, playerId: 5 }]);

			const result = await playerListService().removeMember(1, 1, 5);

			expect(result).toBe(true);
		});

		it('returns false when member not found in list', async () => {
			const list = createMockPlayerList();
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([list]);
			const validationChain = createSelectChain();
			validationChain.where.mockResolvedValueOnce([{ id: 999 }]);
			mockDb.select.mockReset().mockReturnValueOnce(listChain).mockReturnValueOnce(validationChain);
			getChain('delete').returning.mockResolvedValue([]);

			const result = await playerListService().removeMember(1, 1, 999);

			expect(result).toBe(false);
		});
	});

	describe('batchRemoveMembers', () => {
		it('batch deletes members and returns count', async () => {
			const list = createMockPlayerList();
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([list]);
			const validationChain = createSelectChain();
			validationChain.where.mockResolvedValueOnce([{ id: 5 }, { id: 6 }]);
			mockDb.select.mockReset().mockReturnValueOnce(listChain).mockReturnValueOnce(validationChain);
			// batchRemoveMembers now uses db.batch; each inner array is the returning() for one DELETE chunk
			mockDb.batch.mockResolvedValueOnce([
				[{ id: 1, listId: 1, playerId: 5 }, { id: 2, listId: 1, playerId: 6 }],
			]);

			const result = await playerListService().batchRemoveMembers(1, 1, [5, 6]);

			expect(result).toBe(2);
			expect(mockDb.batch).toHaveBeenCalledOnce();
		});

		it('returns 0 when none of the playerIds match', async () => {
			const list = createMockPlayerList();
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([list]);
			const validationChain = createSelectChain();
			validationChain.where.mockResolvedValueOnce([{ id: 999 }]);
			mockDb.select.mockReset().mockReturnValueOnce(listChain).mockReturnValueOnce(validationChain);
			getChain('delete').returning.mockResolvedValue([]);

			const result = await playerListService().batchRemoveMembers(1, 1, [999]);

			expect(result).toBe(0);
		});
	});

	describe('getMemberPlayerIds', () => {
		it('returns array of player IDs', async () => {
			getChain('select').limit.mockResolvedValue([createMockPlayerList()]);
			getChain('select').orderBy.mockResolvedValue([{ playerId: 10 }, { playerId: 20 }]);

			const result = await playerListService().getMemberPlayerIds(1, 1);

			expect(result).toEqual([10, 20]);
		});

		it('returns empty array when no members', async () => {
			getChain('select').limit.mockResolvedValue([createMockPlayerList()]);
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await playerListService().getMemberPlayerIds(1, 1);

			expect(result).toEqual([]);
		});
	});

	describe('getMemberCount', () => {
		it('returns the current number of members for a list', async () => {
			getChain('select').where.mockResolvedValue([{ memberCount: 4 }]);

			const result = await playerListService().getMemberCount(1, 1);

			expect(result).toBe(4);
			expect(getChain('select').innerJoin).toHaveBeenCalledTimes(2);
		});
	});

	describe('getMembers', () => {
		it('returns player records joined from members', async () => {
			const members = [
				{ id: 1, name: 'Player 1', eventId: 1 },
				{ id: 2, name: 'Player 2', eventId: 1 },
			];
			getChain('select').limit.mockResolvedValue([createMockPlayerList()]);
			getChain('select').orderBy.mockResolvedValue(members);

			const result = await playerListService().getMembers(1, 1);

			expect(result).toEqual(members);
			expect(getChain('select').innerJoin).toHaveBeenCalledOnce();
		});

		it('returns empty array when no members', async () => {
			getChain('select').limit.mockResolvedValue([createMockPlayerList()]);
			getChain('select').orderBy.mockResolvedValue([]);

			const result = await playerListService().getMembers(1, 1);

			expect(result).toEqual([]);
		});
	});

	describe('reorderMembers', () => {
		it('updates the exact member permutation in one statement', async () => {
			const list = createMockPlayerList();
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([list]);
			const membersChain = createSelectChain();
			membersChain.orderBy.mockResolvedValueOnce([{ playerId: 10 }, { playerId: 20 }, { playerId: 30 }]);
			mockDb.select.mockReset().mockReturnValueOnce(listChain).mockReturnValueOnce(membersChain);

			const result = await playerListService().reorderMembers(1, 1, [20, 10, 30]);

			expect(result).toEqual({ reordered: 3 });
			expect(mockDb.update).toHaveBeenCalledOnce();
			expect(mockDb.batch).not.toHaveBeenCalled();
		});

		it('rejects a subset instead of silently assigning partial order', async () => {
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([createMockPlayerList()]);
			const membersChain = createSelectChain();
			membersChain.orderBy.mockResolvedValueOnce([{ playerId: 10 }, { playerId: 20 }, { playerId: 30 }]);
			mockDb.select.mockReset().mockReturnValueOnce(listChain).mockReturnValueOnce(membersChain);

			await expect(playerListService().reorderMembers(1, 1, [20, 10])).rejects.toMatchObject({
				statusCode: 400,
			});

			expect(mockDb.update).not.toHaveBeenCalled();
		});

		it('rejects a duplicated member even when the payload length matches', async () => {
			const listChain = createSelectChain();
			listChain.limit.mockResolvedValueOnce([createMockPlayerList()]);
			const membersChain = createSelectChain();
			membersChain.orderBy.mockResolvedValueOnce([{ playerId: 10 }, { playerId: 20 }, { playerId: 30 }]);
			mockDb.select.mockReset().mockReturnValueOnce(listChain).mockReturnValueOnce(membersChain);

			await expect(playerListService().reorderMembers(1, 1, [20, 20, 30])).rejects.toMatchObject({
				statusCode: 400,
			});

			expect(mockDb.update).not.toHaveBeenCalled();
		});
	});
});
