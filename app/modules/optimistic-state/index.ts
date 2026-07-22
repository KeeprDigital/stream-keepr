import { useDebounceFn } from '@vueuse/core';
import { createKeyedGuardedSequence } from '~/utils/guardedSequence';
import { createKeyedQueue } from '~/utils/keyedQueue';

export interface FlushEntry<S, P> {
	/** Pre-optimistic snapshot per target id, for rollback */
	targets: ReadonlyMap<number, S>;
	/** Accumulated payload for this batch key */
	payload: P;
	/** Convenience: the first target's id (single-target batches) */
	id: number;
	/** Convenience: the first target's snapshot (single-target batches) */
	snapshot: S;
}

export interface FlushControls<S> {
	/**
	 * Record state the server has already confirmed mid-flush. If a later part
	 * of the same flush fails, rollback restores the owned fields from the last
	 * committed state instead of the pre-optimistic snapshot, so confirmed
	 * work is never reverted.
	 */
	commit: (state: S | ReadonlyMap<number, S>) => void;
}

/** A flush may return one state (single-target) or a per-target map (bulk). */
export type FlushResult<S> = S | ReadonlyMap<number, S> | null | undefined;

interface OptimisticStateOptions<S> {
	/** Reactive Map of entity state, used for optimistic updates and rollback */
	stateMap: Ref<Map<number, S>>;
	/** Error ref for error reporting */
	errorRef: Ref<string | null>;
}

interface BatchOptions<S, P> {
	/** Execute the API call for a batch entry, return the updated state(s) */
	flush: (entry: FlushEntry<S, P>, controls: FlushControls<S>) => Promise<FlushResult<S>>;
	/** Debounce delay before flushing (ms). Default: 300 */
	debounceMs?: number;
	/** Maximum wait before forcing a flush (ms). Default: 1000 */
	maxWaitMs?: number;
}

interface OwnershipOptions<S> {
	/**
	 * Fields the server result writes beyond what the optimistic change
	 * predicts (e.g. server-recalculated clock values). Field Ownership is
	 * otherwise derived from the optimistic diff.
	 */
	serverOwns?: readonly (keyof S)[];
}

interface TargetState<S> {
	snapshot: S;
	owned: Set<keyof S>;
	release: () => void;
}

/**
 * Optimistic entity state with derived Field Ownership.
 *
 * Every optimistic action owns exactly the fields its predicted change
 * touches (plus any declared `serverOwns` slice). Flush results and
 * rollbacks write only owned fields, and remote state applied while work
 * is pending or in flight never overwrites another action's owned fields.
 * All batches and actions created from one instance share the same
 * ownership claims, so `applyRemote` merges around every live edit.
 */
export function createOptimisticState<S>(options: OptimisticStateOptions<S>) {
	const { executeAction } = useAsyncAction();

	// Live Field Ownership claims per entity id — one claim per pending batch
	// target or in-flight action, released when the work settles.
	const claims = new Map<number, Map<object, ReadonlySet<keyof S>>>();

	function claim(id: number, owned: ReadonlySet<keyof S>): () => void {
		const token = {};
		let forId = claims.get(id);
		if (!forId) {
			forId = new Map();
			claims.set(id, forId);
		}
		forId.set(token, owned);
		return () => {
			forId!.delete(token);
			if (forId!.size === 0)
				claims.delete(id);
		};
	}

	function ownedFieldsFor(id: number): Set<keyof S> {
		const union = new Set<keyof S>();
		for (const owned of claims.get(id)?.values() ?? []) {
			for (const field of owned)
				union.add(field);
		}
		return union;
	}

	function deriveOwnership(current: S, optimistic: S, extra?: readonly (keyof S)[]): Set<keyof S> {
		const owned = new Set<keyof S>();
		for (const field of Object.keys(optimistic as Record<string, unknown>) as (keyof S)[]) {
			if (!Object.is(current[field], optimistic[field]))
				owned.add(field);
		}
		for (const field of extra ?? [])
			owned.add(field);
		return owned;
	}

	function mergeOwned(live: S, source: S, owned: ReadonlySet<keyof S>): S {
		const merged = { ...live };
		for (const field of owned)
			merged[field] = source[field];
		return merged;
	}

	function mergeIntoState(id: number, source: S, owned: ReadonlySet<keyof S>) {
		const live = options.stateMap.value.get(id);
		options.stateMap.value.set(id, live ? mergeOwned(live, source, owned) : source);
	}

	function resultFor(result: FlushResult<S>, id: number): S | undefined {
		if (result == null)
			return undefined;
		return result instanceof Map ? result.get(id) : result as S;
	}

	function normalizeTargets(targets: number | readonly number[]): readonly number[] {
		return typeof targets === 'number' ? [targets] : targets;
	}

	/**
	 * Create a debounced accumulating batch on this instance's ownership core.
	 * Rapid changes for the same key merge into one payload and flush as a
	 * single API call; per-target snapshots and derived Field Ownership drive
	 * the result merge and rollback.
	 */
	function batch<P>(batchOptions: BatchOptions<S, P>) {
		const pending = new Map<string, { targets: Map<number, TargetState<S>>; payload: P }>();
		const flights = createKeyedGuardedSequence();
		const queue = createKeyedQueue();

		const debouncedFlush = useDebounceFn(() => {
			const entries = [...pending.entries()];
			pending.clear();

			for (const [key, entry] of entries) {
				const flight = flights.begin(key);
				// Pending claims stay live through the in-flight flush and are
				// released only once the result (or rollback) has been merged.
				const targets = entry.targets;
				const [firstId, firstTarget] = [...targets.entries()][0]!;
				const snapshots = new Map([...targets.entries()].map(([id, t]) => [id, t.snapshot]));
				const flushEntry: FlushEntry<S, P> = {
					targets: snapshots,
					payload: entry.payload,
					id: firstId,
					snapshot: firstTarget.snapshot,
				};
				let committed: S | ReadonlyMap<number, S> | undefined;
				const controls: FlushControls<S> = {
					commit: (state) => {
						committed = state;
					},
				};
				const releaseAll = () => {
					for (const target of targets.values())
						target.release();
				};

				void queue.enqueue(key, () => executeAction(
					async () => {
						const result = await batchOptions.flush(flushEntry, controls);
						// Only apply the server response if no newer batch has started
						if (flight.current) {
							for (const [id, target] of targets) {
								const state = resultFor(result, id);
								if (state !== undefined)
									mergeIntoState(id, state, target.owned);
							}
						}
						return result;
					},
					{
						errorRef: options.errorRef,
						onError: () => {
							// Only roll back if no newer batch has superseded this one.
							// Confirmed mid-flush progress (commit) is kept; only work past
							// the last committed state rolls back to the snapshot.
							if (flight.current) {
								for (const [id, target] of targets) {
									const baseline = resultFor(committed, id) ?? target.snapshot;
									mergeIntoState(id, baseline, target.owned);
								}
							}
						},
					},
				).finally(releaseAll));
			}
		}, batchOptions.debounceMs ?? 300, { maxWait: batchOptions.maxWaitMs ?? 1000 });

		/**
		 * Enqueue an optimistic update for batching. Field Ownership is derived
		 * from the diff between the current state and the predicted state.
		 *
		 * @param key - Unique key for deduplication (e.g. `${id}` or `${id}-player1`)
		 * @param targets - Entity id(s) the update applies to
		 * @param getOptimistic - Transform current state to optimistic state (applied
		 *   immediately per target); return null to skip a target
		 * @param getPayload - Build or merge the accumulated payload. Receives the existing
		 *   payload if one is already pending for this key, or `undefined` for the first update.
		 */
		function enqueue(
			key: string,
			targets: number | readonly number[],
			getOptimistic: (current: S, id: number) => S | null,
			getPayload: (existing: P | undefined) => P,
			ownership?: OwnershipOptions<S>,
		) {
			const ids = normalizeTargets(targets);
			const existing = pending.get(key);
			const entry = existing ?? { targets: new Map<number, TargetState<S>>(), payload: undefined as P };

			let touched = false;
			for (const id of ids) {
				const current = options.stateMap.value.get(id);
				if (!current)
					continue;

				const optimistic = getOptimistic(current, id);
				if (optimistic === null)
					continue;

				touched = true;
				options.stateMap.value.set(id, optimistic);
				const owned = deriveOwnership(current, optimistic, ownership?.serverOwns);

				const target = entry.targets.get(id);
				if (target) {
					// Union ownership; keep the pre-first-update snapshot.
					for (const field of owned)
						target.owned.add(field);
				}
				else {
					const targetState: TargetState<S> = { snapshot: current, owned, release: () => {} };
					targetState.release = claim(id, targetState.owned);
					entry.targets.set(id, targetState);
				}
			}

			if (!touched && entry.targets.size === 0)
				return;

			entry.payload = getPayload(existing?.payload);
			if (!existing)
				pending.set(key, entry);

			void debouncedFlush();
		}

		function reset() {
			for (const entry of pending.values()) {
				for (const target of entry.targets.values())
					target.release();
			}
			pending.clear();
			flights.supersedeAll();
		}

		return { enqueue, reset };
	}

	// Prevents concurrent in-flight requests for the same discrete action.
	const inFlightActions = new Set<string>();

	/**
	 * Immediate optimistic action with in-flight dedup: concurrent calls for
	 * the same action key are silently dropped (pass null to allow concurrency).
	 * Field Ownership is derived from the optimistic diff; the API result and
	 * any rollback write only owned fields. Multiple targets share one API
	 * call (bulk actions); return null from `getOptimistic` to skip a target.
	 */
	function run(
		actionKey: string | null,
		targets: number | readonly number[],
		getOptimistic: (current: S, id: number) => S | null,
		apiCall: () => Promise<FlushResult<S>>,
		ownership?: OwnershipOptions<S>,
	) {
		if (actionKey && inFlightActions.has(actionKey))
			return null;

		const ids = normalizeTargets(targets);
		const applied = new Map<number, TargetState<S>>();
		for (const id of ids) {
			const current = options.stateMap.value.get(id);
			if (!current)
				continue;
			const optimistic = getOptimistic(current, id);
			if (optimistic === null)
				continue;
			options.stateMap.value.set(id, optimistic);
			const owned = deriveOwnership(current, optimistic, ownership?.serverOwns);
			applied.set(id, { snapshot: current, owned, release: claim(id, owned) });
		}

		if (applied.size === 0)
			return null;

		if (actionKey)
			inFlightActions.add(actionKey);

		const promise = executeAction(
			async () => {
				const result = await apiCall();
				for (const [id, target] of applied) {
					const state = resultFor(result, id);
					if (state !== undefined)
						mergeIntoState(id, state, target.owned);
				}
				return result;
			},
			{
				errorRef: options.errorRef,
				onError: () => {
					for (const [id, target] of applied)
						mergeIntoState(id, target.snapshot, target.owned);
				},
			},
		);

		void promise.finally(() => {
			if (actionKey)
				inFlightActions.delete(actionKey);
			for (const target of applied.values())
				target.release();
		}).catch(() => {});

		return promise;
	}

	/**
	 * Apply externally-produced state (e.g. a remote session frame). Fields
	 * currently owned by pending or in-flight work keep their local value;
	 * everything else takes the remote value.
	 */
	function applyRemote(id: number, state: S) {
		const owned = ownedFieldsFor(id);
		const live = options.stateMap.value.get(id);
		if (!live || owned.size === 0) {
			options.stateMap.value.set(id, state);
			return;
		}
		options.stateMap.value.set(id, mergeOwned(state, live, owned));
	}

	function reset() {
		claims.clear();
		inFlightActions.clear();
	}

	return { batch, run, applyRemote, reset };
}
