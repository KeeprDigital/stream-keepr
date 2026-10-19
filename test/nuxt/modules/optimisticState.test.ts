import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { transportFailure } from '~~/test/helpers/transportFailure';
import { createOptimisticState } from '~/modules/optimistic-state';

/*
 * `useAsyncAction` is deliberately not mocked. The copy that stood here rolled back and
 * resolved `null` but never wrote `errorRef` — so this module could report whatever it
 * liked and every test here would stay green. That is exactly what happened: #262 gave
 * a refused prediction the sentence the server wrote about it, and this suite could not
 * see the difference. The row in 'reporting a refused prediction' is what ended that
 * blindness (#263).
 */

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

interface SlotState { life1: number; life2: number; clockMs: number }

describe('optimistic-state module', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function createTestSetup(flush = vi.fn(async (entry: any) => entry.payload)) {
		const stateMap = ref(new Map<number, SlotState>([[1, { life1: 20, life2: 20, clockMs: 100 }]]));
		const errorRef = ref<string | null>(null);

		const optimistic = createOptimisticState<SlotState>({ stateMap, errorRef });
		const { enqueue } = optimistic.batch<Partial<SlotState>>({
			flush,
			debounceMs: 100,
			maxWaitMs: 500,
		});

		return { stateMap, errorRef, flush, enqueue, run: optimistic.run, applyRemote: optimistic.applyRemote };
	}

	describe('applyRemote during pending work', () => {
		it('a remote state landing while an edit is pending merges around the pending Field Ownership', () => {
			const { stateMap, enqueue, applyRemote } = createTestSetup();

			// Operator taps life +1 — optimistic, batch still pending (no timer advance).
			enqueue('life-1', 1, current => ({ ...current, life1: 21 }), () => ({ life1: 21 }));
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 20, clockMs: 100 });

			// A remote session frame arrives reflecting server state that predates the
			// pending tap: life1 still 20 there, but life2 and the clock have moved.
			applyRemote(1, { life1: 20, life2: 15, clockMs: 90 });

			// The pending tap survives; every unowned field takes the remote value.
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 15, clockMs: 90 });
		});
	});

	describe('run', () => {
		it('applies the optimistic change immediately and merges only the owned fields from the result', async () => {
			let resolveApi!: (state: SlotState) => void;
			const { stateMap, run } = createTestSetup();

			void run('swap', 1, current => ({ ...current, life1: 15 }), () =>
				new Promise<SlotState>((resolve) => {
					resolveApi = resolve;
				}));
			expect(stateMap.value.get(1)).toEqual({ life1: 15, life2: 20, clockMs: 100 });

			// While the call is in flight, another action's remote-ish server result for
			// unowned fields must survive: resolve with a stale clock — only life1 is owned.
			resolveApi({ life1: 15, life2: 20, clockMs: 55 });
			await flushPromises();

			expect(stateMap.value.get(1)).toEqual({ life1: 15, life2: 20, clockMs: 100 });
		});

		it('drops a concurrent call for the same action key', async () => {
			const apiCall = vi.fn(() => new Promise<SlotState>(() => {}));
			const { run } = createTestSetup();

			const first = run('swap', 1, current => ({ ...current, life1: 15 }), apiCall);
			const second = run('swap', 1, current => ({ ...current, life1: 10 }), apiCall);

			expect(first).not.toBeNull();
			expect(second).toBeNull();
			expect(apiCall).toHaveBeenCalledOnce();
		});

		it('rolls back only the owned fields on error, and releases the claim', async () => {
			let rejectApi!: (error: Error) => void;
			const { stateMap, run, applyRemote } = createTestSetup();

			void run('swap', 1, current => ({ ...current, life1: 15 }), () =>
				new Promise<SlotState>((_resolve, reject) => {
					rejectApi = reject;
				}));
			expect(stateMap.value.get(1)).toEqual({ life1: 15, life2: 20, clockMs: 100 });

			// A remote frame lands mid-flight and moves an unowned field.
			applyRemote(1, { life1: 20, life2: 12, clockMs: 80 });
			expect(stateMap.value.get(1)).toEqual({ life1: 15, life2: 12, clockMs: 80 });

			rejectApi(new Error('network error'));
			await flushPromises();

			// life1 rolls back to its pre-optimistic value; the remote-updated fields stay.
			expect(stateMap.value.get(1)).toEqual({ life1: 20, life2: 12, clockMs: 80 });

			// The claim is gone — a later remote write owns the whole state again.
			applyRemote(1, { life1: 19, life2: 12, clockMs: 70 });
			expect(stateMap.value.get(1)).toEqual({ life1: 19, life2: 12, clockMs: 70 });
		});
	});

	describe('reporting a refused prediction', () => {
		/*
		 * A rolled-back optimistic action is where the words matter most: the operator
		 * watched the change appear and then vanish, so the message is the only account of
		 * why. These two rows are the pair — the sentence the authority wrote is reported
		 * where there is one, and the transport's line where there is not.
		 */
		it('reports the sentence the refusal carries, not the transport line', async () => {
			let rejectApi!: (error: unknown) => void;
			const { stateMap, errorRef, run } = createTestSetup();

			void run('swap', 1, current => ({ ...current, life1: 15 }), () =>
				new Promise<SlotState>((_resolve, reject) => {
					rejectApi = reject;
				}));

			rejectApi(transportFailure({
				status: 409,
				body: { message: 'This Feature Match has already been reset' },
				request: `[PATCH] "/api/events/1/feature-matches/1/state"`,
			}));
			await flushPromises();

			expect(errorRef.value).toBe('This Feature Match has already been reset');
			expect(stateMap.value.get(1)).toEqual({ life1: 20, life2: 20, clockMs: 100 });
		});

		it('reports the transport line for a failure that wrote no sentence', async () => {
			let rejectApi!: (error: unknown) => void;
			const { errorRef, run } = createTestSetup();

			void run('swap', 1, current => ({ ...current, life1: 15 }), () =>
				new Promise<SlotState>((_resolve, reject) => {
					rejectApi = reject;
				}));

			rejectApi(transportFailure({
				status: 503,
				request: `[PATCH] "/api/events/1/feature-matches/1/state"`,
			}));
			await flushPromises();

			expect(errorRef.value).toBe('[PATCH] "/api/events/1/feature-matches/1/state": 503 Service Unavailable');
		});
	});

	describe('batched flush with derived Field Ownership', () => {
		it('key A\'s flush result cannot clobber key B\'s still-pending optimistic value', async () => {
			let resolveLife1!: (state: SlotState) => void;
			let resolveLife2!: (state: SlotState) => void;
			const flush = vi.fn((entry: any) => new Promise<SlotState>((resolve) => {
				if ('life1' in entry.payload)
					resolveLife1 = resolve;
				else
					resolveLife2 = resolve;
			}));
			const { stateMap, enqueue } = createTestSetup(flush as any);

			enqueue('life-1', 1, current => ({ ...current, life1: 21 }), () => ({ life1: 21 }));
			enqueue('life-2', 1, current => ({ ...current, life2: 18 }), () => ({ life2: 18 }));

			vi.advanceTimersByTime(200);
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 18, clockMs: 100 });

			// life-1's server response predates life-2's edit — life2 is still 20 there.
			resolveLife1({ life1: 21, life2: 20, clockMs: 100 });
			await flushPromises();
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 18, clockMs: 100 });

			resolveLife2({ life1: 21, life2: 18, clockMs: 100 });
			await flushPromises();
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 18, clockMs: 100 });
		});

		it('keeps the claim through an in-flight flush, releasing it once the result merges', async () => {
			let resolveFlush!: (state: SlotState) => void;
			const flush = vi.fn(() => new Promise<SlotState>((resolve) => {
				resolveFlush = resolve;
			}));
			const { stateMap, enqueue, applyRemote } = createTestSetup(flush as any);

			enqueue('life-1', 1, current => ({ ...current, life1: 21 }), () => ({ life1: 21 }));
			vi.advanceTimersByTime(200);
			expect(flush).toHaveBeenCalledOnce();

			// Flush is in flight — a remote frame must still merge around life1.
			applyRemote(1, { life1: 20, life2: 15, clockMs: 90 });
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 15, clockMs: 90 });

			resolveFlush({ life1: 21, life2: 15, clockMs: 90 });
			await flushPromises();

			// Settled — remote owns the whole state again.
			applyRemote(1, { life1: 25, life2: 15, clockMs: 85 });
			expect(stateMap.value.get(1)).toEqual({ life1: 25, life2: 15, clockMs: 85 });
		});

		it('serverOwns extends ownership to fields the optimistic change never touched', async () => {
			// A clock action: optimistic prediction leaves clockMs alone, but the
			// server recalculates it — the result's clockMs must merge in, and a
			// remote frame mid-flight must NOT overwrite the pending clockMs.
			let resolveFlush!: (state: SlotState) => void;
			const flush = vi.fn(() => new Promise<SlotState>((resolve) => {
				resolveFlush = resolve;
			}));
			const { stateMap, enqueue, applyRemote } = createTestSetup(flush as any);

			enqueue(
				'clock',
				1,
				current => ({ ...current, life1: 21 }),
				() => ({ life1: 21 }),
				{ serverOwns: ['clockMs'] },
			);
			vi.advanceTimersByTime(200);

			applyRemote(1, { life1: 20, life2: 16, clockMs: 90 });
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 16, clockMs: 100 });

			resolveFlush({ life1: 21, life2: 16, clockMs: 42 });
			await flushPromises();
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 16, clockMs: 42 });
		});

		it('rolls owned fields back to the last committed state, not the snapshot', async () => {
			const flush = vi.fn(async (_entry: any, controls: any) => {
				controls.commit({ life1: 21, life2: 20, clockMs: 100 });
				throw new Error('second step failed');
			});
			const { stateMap, enqueue } = createTestSetup(flush as any);

			enqueue('life-1', 1, current => ({ ...current, life1: 21, life2: 19 }), () => ({ life1: 21, life2: 19 }));
			vi.advanceTimersByTime(200);
			await flushPromises();

			// life1 keeps the committed value; life2 rolls back to the snapshot.
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 20, clockMs: 100 });
		});

		it('claims are shared across batches of the same instance', () => {
			const stateMap = ref(new Map<number, SlotState>([[1, { life1: 20, life2: 20, clockMs: 100 }]]));
			const errorRef = ref<string | null>(null);
			const optimistic = createOptimisticState<SlotState>({ stateMap, errorRef });
			const lifeBatch = optimistic.batch<Partial<SlotState>>({ flush: vi.fn(() => new Promise<SlotState>(() => {})), debounceMs: 100 });
			const clockBatch = optimistic.batch<Partial<SlotState>>({ flush: vi.fn(() => new Promise<SlotState>(() => {})), debounceMs: 100 });

			lifeBatch.enqueue('life-1', 1, current => ({ ...current, life1: 21 }), () => ({ life1: 21 }));
			clockBatch.enqueue('clock', 1, current => ({ ...current, clockMs: 110 }), () => ({ clockMs: 110 }));

			// Remote must merge around BOTH batches' Field Ownership.
			optimistic.applyRemote(1, { life1: 20, life2: 15, clockMs: 90 });
			expect(stateMap.value.get(1)).toEqual({ life1: 21, life2: 15, clockMs: 110 });
		});
	});

	describe('multi-target entries (bulk actions)', () => {
		function createBulkSetup(flush: (entry: any, controls: any) => Promise<ReadonlyMap<number, SlotState>>) {
			const stateMap = ref(new Map<number, SlotState>([
				[1, { life1: 20, life2: 20, clockMs: 100 }],
				[2, { life1: 20, life2: 20, clockMs: 200 }],
			]));
			const errorRef = ref<string | null>(null);
			const optimistic = createOptimisticState<SlotState>({ stateMap, errorRef });
			const bulk = optimistic.batch<{ deltaMs: number }>({ flush: flush as any, debounceMs: 100, maxWaitMs: 500 });
			return { stateMap, optimistic, bulk };
		}

		it('an accumulating bulk batch claims and merges per target', async () => {
			let resolveFlush!: (states: ReadonlyMap<number, SlotState>) => void;
			const flush = vi.fn(() => new Promise<ReadonlyMap<number, SlotState>>((resolve) => {
				resolveFlush = resolve;
			}));
			const { stateMap, optimistic, bulk } = createBulkSetup(flush);

			bulk.enqueue(
				'all',
				[1, 2],
				current => ({ ...current, clockMs: current.clockMs - 10 }),
				existing => ({ deltaMs: (existing?.deltaMs ?? 0) - 10 }),
			);
			expect(stateMap.value.get(1)!.clockMs).toBe(90);
			expect(stateMap.value.get(2)!.clockMs).toBe(190);

			// Remote frames for both Slots merge around the pending clock ownership.
			optimistic.applyRemote(1, { life1: 11, life2: 20, clockMs: 100 });
			expect(stateMap.value.get(1)).toEqual({ life1: 11, life2: 20, clockMs: 90 });

			vi.advanceTimersByTime(200);
			resolveFlush(new Map([
				[1, { life1: 11, life2: 20, clockMs: 90 }],
				[2, { life1: 20, life2: 20, clockMs: 190 }],
			]));
			await flushPromises();
			expect(stateMap.value.get(1)).toEqual({ life1: 11, life2: 20, clockMs: 90 });
			expect(stateMap.value.get(2)).toEqual({ life1: 20, life2: 20, clockMs: 190 });
		});

		it('a failed bulk flush rolls each target back to its own snapshot, owned fields only', async () => {
			const flush = vi.fn(async () => {
				throw new Error('bulk failed');
			});
			const { stateMap, optimistic, bulk } = createBulkSetup(flush as any);

			bulk.enqueue(
				'all',
				[1, 2],
				current => ({ ...current, clockMs: current.clockMs - 10 }),
				existing => ({ deltaMs: (existing?.deltaMs ?? 0) - 10 }),
			);

			// An unowned field moves remotely mid-pending — rollback must not revert it.
			optimistic.applyRemote(2, { life1: 7, life2: 20, clockMs: 300 });
			expect(stateMap.value.get(2)).toEqual({ life1: 7, life2: 20, clockMs: 190 });

			vi.advanceTimersByTime(200);
			await flushPromises();

			expect(stateMap.value.get(1)).toEqual({ life1: 20, life2: 20, clockMs: 100 });
			expect(stateMap.value.get(2)).toEqual({ life1: 7, life2: 20, clockMs: 200 });
		});

		it('run accepts multiple targets and skips ids whose optimistic change is null', async () => {
			const stateMap = ref(new Map<number, SlotState>([
				[1, { life1: 20, life2: 20, clockMs: 100 }],
				[2, { life1: 20, life2: 20, clockMs: 200 }],
			]));
			const errorRef = ref<string | null>(null);
			const optimistic = createOptimisticState<SlotState>({ stateMap, errorRef });

			let resolveApi!: (states: ReadonlyMap<number, SlotState>) => void;
			// Slot 2 is skipped (already in the target state) — only Slot 1 changes.
			void optimistic.run(
				'bulk:set-clock',
				[1, 2],
				current => (current.clockMs === 200 ? null : { ...current, clockMs: 200 }),
				() => new Promise<ReadonlyMap<number, SlotState>>((resolve) => {
					resolveApi = resolve;
				}),
			);
			expect(stateMap.value.get(1)!.clockMs).toBe(200);
			expect(stateMap.value.get(2)!.clockMs).toBe(200);

			resolveApi(new Map([[1, { life1: 20, life2: 20, clockMs: 200 }]]));
			await flushPromises();
			expect(stateMap.value.get(1)).toEqual({ life1: 20, life2: 20, clockMs: 200 });
			expect(stateMap.value.get(2)).toEqual({ life1: 20, life2: 20, clockMs: 200 });
		});
	});
	describe('settling against an authority', () => {
		/**
		 * The authority stands in for a Live State Follower: an API call that answers
		 * offers its result to it, and it keeps whichever is newer. A refused result
		 * leaves the authority on the newer state.
		 */
		function createAuthoritySetup(initial: SlotState) {
			const stateMap = ref(new Map<number, SlotState>([[1, { ...initial }]]));
			const errorRef = ref<string | null>(null);
			const held = new Map<number, { sequence: number; state: SlotState }>([[1, { sequence: 0, state: { ...initial } }]]);
			const optimistic = createOptimisticState<SlotState>({
				stateMap,
				errorRef,
				authority: id => held.get(id)?.state,
			});
			function answer(sequence: number, state: SlotState) {
				const known = held.get(1)!;
				if (sequence > known.sequence)
					held.set(1, { sequence, state });
				return held.get(1)!.state;
			}
			function deferred() {
				let resolve!: () => void;
				let reject!: (cause: unknown) => void;
				const promise = new Promise<void>((done, fail) => {
					resolve = done;
					reject = fail;
				});
				return { promise, resolve, reject };
			}
			return { stateMap, held, optimistic, answer, deferred };
		}

		it('an older answer settling after a newer one renders the newer, not its own', async () => {
			const { stateMap, optimistic, answer, deferred } = createAuthoritySetup({ life1: 20, life2: 20, clockMs: 100 });
			// Reveal-like: one action owning both players, accepted first (sequence 1).
			const reveal = deferred();
			void optimistic.run('reveal', 1, current => ({ ...current, life2: 0 }), () =>
				reveal.promise.then(() => answer(1, { life1: 20, life2: 0, clockMs: 100 })), { serverOwns: ['life1'] });
			// Life-like: owning the first player, accepted second (sequence 2), answered first.
			const life = deferred();
			void optimistic.run('life', 1, current => ({ ...current, life1: 19 }), () =>
				life.promise.then(() => answer(2, { life1: 19, life2: 0, clockMs: 100 })));

			life.resolve();
			await flushPromises();
			reveal.resolve();
			await flushPromises();

			expect(stateMap.value.get(1)).toEqual({ life1: 19, life2: 0, clockMs: 100 });
		});

		it('settling an older command keeps a newer pending edit to the same field', async () => {
			const { stateMap, optimistic, answer, deferred } = createAuthoritySetup({ life1: 20, life2: 20, clockMs: 100 });
			const { enqueue } = optimistic.batch<{ life1: number }>({
				flush: async entry => answer(2, { life1: entry.payload.life1, life2: 20, clockMs: 100 }),
				debounceMs: 100,
				maxWaitMs: 500,
			});
			const first = deferred();
			void optimistic.run('first', 1, current => ({ ...current, life1: 19 }), () =>
				first.promise.then(() => answer(1, { life1: 19, life2: 20, clockMs: 100 })));
			enqueue('life', 1, current => ({ ...current, life1: 18 }), () => ({ life1: 18 }));

			first.resolve();
			await flushPromises();

			expect(stateMap.value.get(1)?.life1).toBe(18);

			await vi.advanceTimersByTimeAsync(100);
			await flushPromises();

			expect(stateMap.value.get(1)?.life1).toBe(18);
		});

		it('a failure across a new epoch renders the new epoch, keeping a pending edit', async () => {
			const { stateMap, held, optimistic, deferred } = createAuthoritySetup({ life1: 20, life2: 20, clockMs: 100 });
			const { enqueue } = optimistic.batch<{ life2: number }>({
				flush: () => new Promise(() => {}),
				debounceMs: 100,
				maxWaitMs: 500,
			});
			const refused = deferred();
			void optimistic.run('life', 1, current => ({ ...current, life1: 19 }), () =>
				refused.promise.then(() => held.get(1)!.state));
			enqueue('other', 1, current => ({ ...current, life2: 17 }), () => ({ life2: 17 }));

			// The Session is replaced: a new epoch starts every field afresh.
			const fresh = { life1: 40, life2: 40, clockMs: 0 };
			held.set(1, { sequence: 1, state: fresh });
			optimistic.applyRemote(1, fresh);
			refused.reject(new Error('Session ended'));
			await flushPromises();

			expect(stateMap.value.get(1)).toEqual({ life1: 40, life2: 17, clockMs: 0 });
		});
	});
});
