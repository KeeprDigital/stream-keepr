import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { realtimeHandlersFor } from '~~/test/nuxt/helpers/realtimeEventSession';

const mockRepo = vi.hoisted(() => ({
	list: vi.fn(),
	getById: vi.fn(),
	create: vi.fn(),
	update: vi.fn(),
	remove: vi.fn(),
}));

vi.mock('~/modules/event-data/client', async importOriginal => ({
	...(await importOriginal<typeof import('~~/app/modules/event-data/client')>()),
	useEventDataResource: () => mockRepo,
}));

const mockMetagameStore = {
	applyRemoteInvalidated: vi.fn(),
};
mockNuxtImport('useMetagameStore', () => () => mockMetagameStore);

const { deliver } = realtimeHandlersFor();

describe('usePlayerStore', () => {
	let store: ReturnType<typeof usePlayerStore>;

	beforeEach(() => {
		store = usePlayerStore();
		store.$reset();
	});

	// Watchers that depend on Player data, not just the array's length, follow `dataVersion`.
	describe('dataVersion ticks on every Player mutation', () => {
		it.each([
			[
				'a load',
				async (s: ReturnType<typeof usePlayerStore>) => {
					mockRepo.list.mockResolvedValue([
						createMockPlayer({ id: 1 }),
					]);
					await s.loadPlayersByEventId(1);
				},
			],
			[
				'a create',
				async (s: ReturnType<typeof usePlayerStore>) => {
					mockRepo.create.mockResolvedValue(createMockPlayer({ id: 2 }));
					await s.createPlayer(1, { name: 'Bob' } as never);
				},
			],
			[
				'an update',
				async (s: ReturnType<typeof usePlayerStore>) => {
					s.players = [
						createMockPlayer({ id: 1 }),
					];
					mockRepo.update.mockResolvedValue(createMockPlayer({ id: 1, name: 'Renamed' }));
					await s.updatePlayer(1, 1, { name: 'Renamed' });
				},
			],
			[
				'a delete',
				async (s: ReturnType<typeof usePlayerStore>) => {
					s.players = [
						createMockPlayer({ id: 1 }),
					];
					mockRepo.remove.mockResolvedValue({ success: true });
					await s.removePlayer(1, 1);
				},
			],
			[
				'a peer\'s create',
				async () => deliver('player:created', {
					player: createMockPlayer({ id: 3 }),
				} as never),
			],
			[
				'a peer\'s update',
				async (s: ReturnType<typeof usePlayerStore>) => {
					s.players = [
						createMockPlayer({ id: 1 }),
					];
					deliver('player:updated', {
						player: createMockPlayer({ id: 1, name: 'Renamed' }),
					} as never);
				},
			],
			[
				'a peer\'s delete',
				async (s: ReturnType<typeof usePlayerStore>) => {
					s.players = [
						createMockPlayer({ id: 1 }),
					];
					deliver('player:deleted', { playerId: 1 } as never);
				},
			],
		])('%s', async (_, mutate) => {
			const before = store.dataVersion;

			await mutate(store);

			expect(store.dataVersion).toBeGreaterThan(before);
		});

		it('and is back to 0 after a reset', async () => {
			mockRepo.list.mockResolvedValue([]);
			await store.loadPlayersByEventId(1);

			store.$reset();

			expect(store.dataVersion).toBe(0);
		});
	});

	it('a peer\'s Player message invalidates the Metagame', () => {
		deliver('player:created', {
			player: createMockPlayer({ id: 3 }),
		} as never);

		expect(mockMetagameStore.applyRemoteInvalidated).toHaveBeenCalledOnce();
	});

	describe('getPlayerById', () => {
		it('reads one Player', async () => {
			mockRepo.getById.mockResolvedValue(createMockPlayer({ id: 9, name: 'Alice' }));

			await expect(store.getPlayerById(1, 9)).resolves.toEqual(expect.objectContaining({ id: 9, name: 'Alice' }));
		});

		it('reports the server\'s sentence for a refused read', async () => {
			mockRepo.getById.mockRejectedValue(transportFailure({
				status: 404,
				body: { message: 'That Player is not in this Event' },
			}));

			await store.getPlayerById(1, 9);

			expect(store.error).toBe('That Player is not in this Event');
		});
	});

	describe('holdPlayer', () => {
		it('holds a Player a Screen Output read answered, replacing the one held with the same id', () => {
			store.holdPlayer(createMockPlayer({ id: 1, name: 'Alice' }));
			store.holdPlayer(createMockPlayer({ id: 2, name: 'Bob' }));
			store.holdPlayer(createMockPlayer({ id: 1, name: 'Alicia' }));

			expect(store.players.map(player => player.name)).toEqual(['Alicia', 'Bob']);
		});
	});
});
