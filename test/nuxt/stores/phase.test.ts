import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockPhase } from '~~/test/helpers/fixtures';
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
 * `useAsyncAction` is deliberately not mocked. The copy that stood here was
 * `async fn => fn()` — it never caught, so nothing in this suite could observe what
 * this store does with a refused request, and the optimistic rollback in
 * `useStoreHelpers` never ran either. Running the real composable is what lets the
 * sentence this store reports since #262 be seen from here (#263, #241).
 */

describe('usePhaseStore', () => {
	let store: ReturnType<typeof usePhaseStore>;

	beforeEach(() => {
		store = usePhaseStore();
		store.$reset();
		vi.clearAllMocks();
		mockAbly.onRoom.mockImplementation((storeName: string, callbacks: Record<string, (...args: unknown[]) => void>) => {
			ablyCallbacks[storeName] = callbacks;
		});
		ablyCallbacks.phase = {
			'phase:created': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteCreated(data as any),
			'phase:updated': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteUpdated(data as any),
			'phase:deleted': data => !(mockIsSelfOrigin as any)(data) && store.applyRemoteDeleted(data as any),
		};
	});

	// ── Loading ──

	describe('loadPhasesByEventId', () => {
		it('populates state', async () => {
			const phases = [
				createMockPhase({ id: 1, name: 'Swiss' }),
				createMockPhase({ id: 2, name: 'Top 8' }),
			];
			mockRepo.list.mockResolvedValue(phases);

			await store.loadPhasesByEventId(1);

			expect(store.phases).toEqual(phases);
			expect(store.isLoaded).toBe(true);
			expect(mockRepo.list).toHaveBeenCalledWith(1);
		});
	});

	// ── Create ──

	describe('createPhase', () => {
		it('adds phase to state', async () => {
			const created = createMockPhase({ id: 3, name: 'Top 8' });
			mockRepo.create.mockResolvedValue(created);

			await store.createPhase(1, { name: 'Top 8' });

			expect(store.phases).toContainEqual(created);
		});
	});

	// ── Update (optimistic) ──

	describe('updatePhase', () => {
		it('optimistically updates then applies server response', async () => {
			const phase = createMockPhase({ id: 1, name: 'Swiss' });
			store.phases = [phase];

			const serverUpdated = { ...phase, name: 'Swiss Updated' };
			mockRepo.update.mockResolvedValue(serverUpdated);

			await store.updatePhase(1, 1, { name: 'Swiss Updated' });

			expect(store.phases[0]!.name).toBe('Swiss Updated');
		});
	});

	// ── Remove (optimistic) ──

	describe('removePhase', () => {
		it('removes phase from state', async () => {
			const phase = createMockPhase({ id: 1 });
			store.phases = [phase];
			mockRepo.remove.mockResolvedValue({ success: true });

			await store.removePhase(1, 1);

			expect(store.phases).toHaveLength(0);
		});
	});

	// ── Failure reporting ──

	describe('failure reporting', () => {
		/*
		 * #262 gave this store the sentence through the Event Data lifecycle seam, but no
		 * test here could see it: the seam this suite stood in for never caught, so
		 * neither the report nor the optimistic rollback beneath it ever ran. This is that
		 * store's own pin (#263).
		 */
		it('reports the sentence a refused delete carries, and puts the phase back', async () => {
			const phase = createMockPhase({ id: 1, name: 'Swiss' });
			store.phases = [phase];
			mockRepo.remove.mockRejectedValue(transportFailure({
				status: 409,
				body: { message: 'That Phase still has Rounds in it' },
				request: `[DELETE] "/api/events/1/phases/1"`,
			}));

			await store.removePhase(1, 1);

			expect(store.error).toBe('That Phase still has Rounds in it');
			expect(store.phases).toEqual([phase]);
		});
	});

	// ── Getters ──

	describe('getPhaseById', () => {
		it('returns phase when found', () => {
			const phase = createMockPhase({ id: 5 });
			store.phases = [phase];

			expect(store.getPhaseById(5)).toEqual(phase);
		});
	});

	// ── Realtime Handlers ──

	describe('realtime handlers', () => {
		describe('phase:created', () => {
			it('adds phase from remote message', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadPhasesByEventId(1);
				store.phases = [];

				const phase = createMockPhase({ id: 10, eventId: 1 });

				ablyCallbacks.phase!['phase:created']!({ phase });

				expect(store.phases).toHaveLength(1);
				expect(store.phases[0]!.id).toBe(10);
			});

			it('skips phase from different event', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadPhasesByEventId(1);
				store.phases = [];

				const phase = createMockPhase({ id: 10, eventId: 999 });

				ablyCallbacks.phase!['phase:created']!({ phase });

				expect(store.phases).toHaveLength(0);
			});

			it('skips duplicate phases', async () => {
				mockRepo.list.mockResolvedValue([]);
				await store.loadPhasesByEventId(1);

				const phase = createMockPhase({ id: 10, eventId: 1 });
				store.phases = [phase];

				ablyCallbacks.phase!['phase:created']!({ phase });

				expect(store.phases).toHaveLength(1);
			});

			it('skips when isSelfOrigin returns true', async () => {
				mockIsSelfOrigin.mockReturnValueOnce(true);
				mockRepo.list.mockResolvedValue([]);
				await store.loadPhasesByEventId(1);
				store.phases = [];

				ablyCallbacks.phase!['phase:created']!({ phase: createMockPhase({ id: 10, eventId: 1 }) });

				expect(store.phases).toHaveLength(0);
			});
		});

		describe('phase:updated', () => {
			it('updates existing phase from remote message', () => {
				store.phases = [createMockPhase({ id: 10, name: 'Old' })];

				ablyCallbacks.phase!['phase:updated']!({ phase: createMockPhase({ id: 10, name: 'New' }) });

				expect(store.phases[0]!.name).toBe('New');
			});

			it('skips when isSelfOrigin returns true', () => {
				store.phases = [createMockPhase({ id: 10, name: 'Old' })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.phase!['phase:updated']!({ phase: createMockPhase({ id: 10, name: 'New' }) });

				expect(store.phases[0]!.name).toBe('Old');
			});
		});

		describe('phase:deleted', () => {
			it('removes phase from remote message', () => {
				store.phases = [createMockPhase({ id: 10 })];

				ablyCallbacks.phase!['phase:deleted']!({ phaseId: 10 });

				expect(store.phases).toHaveLength(0);
			});

			it('skips when isSelfOrigin returns true', () => {
				store.phases = [createMockPhase({ id: 10 })];
				mockIsSelfOrigin.mockReturnValueOnce(true);

				ablyCallbacks.phase!['phase:deleted']!({ phaseId: 10 });

				expect(store.phases).toHaveLength(1);
			});
		});
	});

	// ── $reset ──

	describe('$reset', () => {
		it('clears all state', () => {
			store.phases = [createMockPhase()];
			store.error = 'some error';

			store.$reset();

			expect(store.phases).toEqual([]);
			expect(store.error).toBeNull();
			expect(store.loading).toBe(false);
			expect(store.isLoaded).toBe(false);
		});
	});
});
