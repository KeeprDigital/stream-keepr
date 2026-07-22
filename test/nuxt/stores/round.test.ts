import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockRound } from '~~/test/helpers/fixtures';
import { createMockRealtime } from '~~/test/helpers/realtime-mock';

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
mockNuxtImport('useAsyncAction', () => () => ({
	executeAction: vi.fn(async (fn: any) => fn()),
}));

describe('useRoundStore', () => {
	let store: ReturnType<typeof useRoundStore>;

	beforeEach(() => {
		store = useRoundStore();
		store.$reset();
		vi.clearAllMocks();
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.round = {
			'round:created': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCreated(data as any),
			'round:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'round:deleted': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteDeleted(data as any),
		};
	});

	// ── Loading ──

	describe('loadRoundsByEventId', () => {
		it('populates state', async () => {
			const rounds = [
				createMockRound({ id: 1, name: 'Round 1' }),
				createMockRound({ id: 2, name: 'Round 2' }),
			];
			mockRepo.list.mockResolvedValue(rounds);

			await store.loadRoundsByEventId(1);

			expect(store.rounds).toEqual(rounds);
			expect(store.isLoaded).toBe(true);
			expect(mockRepo.list).toHaveBeenCalledWith(1);
		});
	});

	// ── Create ──

	describe('createRound', () => {
		it('adds round to state', async () => {
			const created = createMockRound({ id: 3, name: 'Round 3' });
			mockRepo.create.mockResolvedValue(created);

			await store.createRound(1, { name: 'Round 3', roundNumber: 3, phaseId: 1 });

			expect(store.rounds).toContainEqual(created);
		});
	});

	// ── Update (optimistic) ──

	describe('updateRound', () => {
		it('optimistically updates then applies server response', async () => {
			const round = createMockRound({ id: 1, name: 'Round 1' });
			store.rounds = [round];

			const serverUpdated = { ...round, name: 'Round 1 Updated' };
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updateRound(1, 1, { name: 'Round 1 Updated' });

			expect(store.rounds[0]!.name).toBe('Round 1 Updated');
		});
	});

	// ── Remove (optimistic) ──

	describe('removeRound', () => {
		it('removes round from state', async () => {
			const round = createMockRound({ id: 1 });
			store.rounds = [round];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removeRound(1, 1);

			expect(store.rounds).toHaveLength(0);
		});
	});

	// ── Getters ──

	describe('getRoundById', () => {
		it('returns round when found', () => {
			const round = createMockRound({ id: 5 });
			store.rounds = [round];

			expect(store.getRoundById(5)).toEqual(round);
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('round:created', () => {
			it('adds round from remote message', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadRoundsByEventId(1);
				store.rounds = [];

				const round = createMockRound({ id: 10, eventId: 1 });

				ablyCallbacks.round!['round:created']!({ round });

				expect(store.rounds).toHaveLength(1);
				expect(store.rounds[0]!.id).toBe(10);
			});

			it('skips round from different event', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadRoundsByEventId(1);
				store.rounds = [];

				const round = createMockRound({ id: 10, eventId: 999 });

				ablyCallbacks.round!['round:created']!({ round });

				expect(store.rounds).toHaveLength(0);
			});

			it('skips duplicate rounds', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadRoundsByEventId(1);

				const round = createMockRound({ id: 10, eventId: 1 });
				store.rounds = [round];

				ablyCallbacks.round!['round:created']!({ round });

				expect(store.rounds).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', async () => {
				mockIsSelfOrigin.mockReturnValueOnce(true);
				mockRepo.list.mockResolvedValue([]);
				await store.loadRoundsByEventId(1);
				store.rounds = [];

				ablyCallbacks.round!['round:created']!({ round: createMockRound({ id: 10, eventId: 1 }) });

				expect(store.rounds).toHaveLength(0);
			});
		});

		describe('round:updated', () => {
			it('updates existing round from remote message', () => {
				store.rounds = [createMockRound({ id: 10, name: 'Old' })];

				ablyCallbacks.round!['round:updated']!({ round: createMockRound({ id: 10, name: 'New' }) });

				expect(store.rounds[0]!.name).toBe('New');
			});

			it('skips when isSelfOrigin returns true', () => {
				store.rounds = [createMockRound({ id: 10, name: 'Old' })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.round!['round:updated']!({ round: createMockRound({ id: 10, name: 'New' }) });

				expect(store.rounds[0]!.name).toBe('Old');
			});
		});

		describe('round:deleted', () => {
			it('removes round from remote message', () => {
				store.rounds = [createMockRound({ id: 10 })];

				ablyCallbacks.round!['round:deleted']!({ roundId: 10 });

				expect(store.rounds).toHaveLength(0);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.rounds = [createMockRound({ id: 10 })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.round!['round:deleted']!({ roundId: 10 });

				expect(store.rounds).toHaveLength(1);
			});
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.rounds = [createMockRound()];
			store.error = 'some error';

			store.$reset();

			expect(store.rounds).toEqual([]);
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.isLoaded).toBe(false);
		});
	});
});
