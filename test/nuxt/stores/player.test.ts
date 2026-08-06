import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPlayer } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';
import { transportFailure } from '~~/test/helpers/transportFailure';

// ── Mock Dependencies ──

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

const mockAbly = createMockRealtime();
const mockIsSelfOrigin = vi.fn(() => false);

const ablyCallbacks: Record<string, Record<string, (...args: unknown[]) => void>> = {};
mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
	ablyCallbacks[storeName] = callbacks;
});

mockNuxtImport('useRealtime', () => () => mockAbly);

/*
 * `useAsyncAction` is deliberately not mocked, for the reason #245's suite gives: it is
 * the seam every action here reports through, and the hand-written copy that used to
 * stand in for it never caught anything — so `error` was never written and no test here
 * could say what an operator is shown. The real composable is auto-imported, does no I/O
 * and starts no timers (#241, #263).
 */

describe('usePlayerStore', () => {
	let store: ReturnType<typeof usePlayerStore>;

	beforeEach(() => {
		store = usePlayerStore();
		store.$reset();
		vi.clearAllMocks();
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.player = {
			'player:created': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCreated(data as any),
			'player:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'player:deleted': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteDeleted(data as any),
		};
	});

	// ── Loading ──

	describe('loadPlayersByEventId', () => {
		it('populates players state', async () => {
			const players = [
				createMockPlayer({ id: 1, name: 'Alice' }),
				createMockPlayer({ id: 2, name: 'Bob' }),
			];
			mockRepo.list.mockResolvedValue(players);

			await store.loadPlayersByEventId(1);

			expect(store.players).toEqual(players);
			expect(store.isLoaded).toBe(true);
		});

		it('increments dataVersion', async () => {
			mockRepo.list.mockResolvedValue([createMockPlayer()]);
			const before = store.dataVersion;

			await store.loadPlayersByEventId(1);

			expect(store.dataVersion).toBe(before + 1);
		});
	});

	describe('getPlayerById', () => {
		it('returns player from repo', async () => {
			const player = createMockPlayer({ id: 1 });
			mockRepo.getById.mockResolvedValue(player);

			const result = await store.getPlayerById(1, 1);

			expect(result).toEqual(player);
		});
	});

	// ── Create ──

	describe('createPlayer', () => {
		it('adds player to state', async () => {
			const created = createMockPlayer({ id: 3, name: 'Charlie' });
			mockRepo.create.mockResolvedValue(created);

			await store.createPlayer(1, { name: 'Charlie' });

			expect(store.players).toContainEqual(created);
		});

		it('increments dataVersion', async () => {
			mockRepo.create.mockResolvedValue(createMockPlayer({ id: 3 }));
			const before = store.dataVersion;

			await store.createPlayer(1, { name: 'Charlie' });

			expect(store.dataVersion).toBe(before + 1);
		});
	});

	// ── Update (optimistic) ──

	describe('updatePlayer', () => {
		it('optimistically updates then applies server response', async () => {
			const player = createMockPlayer({ id: 1, name: 'Alice' });
			store.players = [player];

			const serverUpdated = { ...player, name: 'Alice Updated' };
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updatePlayer(1, 1, { name: 'Alice Updated' });

			expect(store.players[0]!.name).toBe('Alice Updated');
		});

		it('increments dataVersion', async () => {
			const player = createMockPlayer({ id: 1, name: 'Alice' });
			store.players = [player];
			mockRepo.update.mockResolvedValue({ ...player, name: 'Alice Updated' });
			const before = store.dataVersion;

			await store.updatePlayer(1, 1, { name: 'Alice Updated' });

			expect(store.dataVersion).toBe(before + 1);
		});
	});

	// ── Remove (optimistic) ──

	describe('removePlayer', () => {
		it('removes player from state', async () => {
			const player = createMockPlayer({ id: 1 });
			store.players = [player];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removePlayer(1, 1);

			expect(store.players).toHaveLength(0);
		});

		it('increments dataVersion', async () => {
			const player = createMockPlayer({ id: 1 });
			store.players = [player];
			mockRepo.remove.mockResolvedValue({ success: true });
			const before = store.dataVersion;

			await store.removePlayer(1, 1);

			expect(store.dataVersion).toBe(before + 1);
		});
	});

	// ── Failure reporting ──

	describe('failure reporting', () => {
		it('reports the sentence the server wrote about a refused update, and rolls the row back', async () => {
			const player = createMockPlayer({ id: 1, name: 'Alice' });
			store.players = [player];
			mockRepo.update.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'Another Player in this Event already has that Melee username' },
			}));

			await store.updatePlayer(1, 1, { name: 'Alice Updated' });

			expect(store.error).toBe('Another Player in this Event already has that Melee username');
			expect(store.players[0]!.name).toBe('Alice');
		});

		it('reports the sentence a refused single-player read carries', async () => {
			mockRepo.getById.mockRejectedValue(transportFailure({
				status: 404,
				body: { message: 'That Player is not in this Event' },
				request: `[GET] "/api/events/1/players/9"`,
			}));

			await store.getPlayerById(1, 9);

			expect(store.error).toBe('That Player is not in this Event');
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('player:created', () => {
			it('adds player from remote message', () => {
				store.players = [];
				const player = createMockPlayer({ id: 10, name: 'Remote' });

				ablyCallbacks.player!['player:created']!({ player });

				expect(store.players).toHaveLength(1);
				expect(store.players[0]!.name).toBe('Remote');
			});

			it('increments dataVersion', () => {
				store.players = [];
				const before = store.dataVersion;

				ablyCallbacks.player!['player:created']!({ player: createMockPlayer({ id: 10 }) });

				expect(store.dataVersion).toBe(before + 1);
			});

			it('skips duplicate players', () => {
				const player = createMockPlayer({ id: 10 });
				store.players = [player];

				ablyCallbacks.player!['player:created']!({ player });

				expect(store.players).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', () => {
				mockIsSelfOrigin.mockReturnValueOnce(true);
				store.players = [];

				ablyCallbacks.player!['player:created']!({ player: createMockPlayer({ id: 10 }) });

				expect(store.players).toHaveLength(0);
			});
		});

		describe('player:updated', () => {
			it('updates existing player from remote message', () => {
				store.players = [createMockPlayer({ id: 10, name: 'Old' })];

				ablyCallbacks.player!['player:updated']!({ player: createMockPlayer({ id: 10, name: 'New' }) });

				expect(store.players[0]!.name).toBe('New');
			});

			it('increments dataVersion on update', () => {
				store.players = [createMockPlayer({ id: 10, name: 'Old' })];
				const before = store.dataVersion;

				ablyCallbacks.player!['player:updated']!({ player: createMockPlayer({ id: 10, name: 'New' }) });

				expect(store.dataVersion).toBe(before + 1);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.players = [createMockPlayer({ id: 10, name: 'Old' })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.player!['player:updated']!({ player: createMockPlayer({ id: 10, name: 'New' }) });

				expect(store.players[0]!.name).toBe('Old');
			});
		});

		describe('player:deleted', () => {
			it('removes player from remote message', () => {
				store.players = [createMockPlayer({ id: 10 })];

				ablyCallbacks.player!['player:deleted']!({ playerId: 10 });

				expect(store.players).toHaveLength(0);
			});

			it('increments dataVersion on delete', () => {
				store.players = [createMockPlayer({ id: 10 })];
				const before = store.dataVersion;

				ablyCallbacks.player!['player:deleted']!({ playerId: 10 });

				expect(store.dataVersion).toBe(before + 1);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.players = [createMockPlayer({ id: 10 })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.player!['player:deleted']!({ playerId: 10 });

				expect(store.players).toHaveLength(1);
			});
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state including dataVersion', () => {
			store.players = [createMockPlayer()];
			store.error = 'some error';

			store.$reset();

			expect(store.players).toEqual([]);
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.isLoaded).toBe(false);
			expect(store.dataVersion).toBe(0);
		});
	});
});
