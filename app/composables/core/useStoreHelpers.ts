import type { Flight } from '~/utils/guardedSequence';

/**
 * Shared helpers for CRUD store patterns.
 * Provides optimistic update and delete with automatic rollback,
 * wrapping `useAsyncAction` for consistent error handling.
 */

interface OptimisticUpdateConfig<T, TUpdates extends object = Partial<T>> {
	items: Ref<T[]>;
	id: number;
	updates: TUpdates;
	apiCall: () => Promise<T>;
	errorRef: Ref<string | null>;
	entityLabel: string;
	onSuccess?: () => void;
	/** The lifetime `items` belongs to; once stale, neither the answer nor the rollback lands in it. */
	flight?: Flight;
	/**
	 * Offers the answer to what `items` follows, answering whether it lands. One that
	 * does not is left behind, and the held item answers in its place.
	 */
	admit?: (updated: T) => boolean;
}

interface OptimisticDeleteConfig<T> {
	items: Ref<T[]>;
	id: number;
	apiCall: () => Promise<unknown>;
	errorRef: Ref<string | null>;
	entityLabel: string;
	onSuccess?: () => void;
	/** The lifetime `items` belongs to; once stale, neither the answer nor the rollback lands in it. */
	flight?: Flight;
}

export function useStoreHelpers() {
	const { executeAction } = useAsyncAction();

	/**
	 * Optimistically updates an item in the list, rolling back on failure.
	 * Applies updates immediately, then confirms via API. On error, restores original.
	 */
	async function optimisticUpdate<T extends { id: number }, TUpdates extends object = Partial<T>>(
		config: OptimisticUpdateConfig<T, TUpdates>,
	): Promise<T | null> {
		const { items, id, updates, apiCall, errorRef, entityLabel, onSuccess, flight = unguarded, admit } = config;

		const index = items.value.findIndex(item => item.id === id);
		if (index === -1) {
			errorRef.value = `${entityLabel} not found`;
			return null;
		}

		const original = structuredClone(toRaw(items.value[index]!));
		items.value[index] = { ...items.value[index]!, ...updates };

		return executeAction(
			async () => {
				const updated = await apiCall();
				if (flight.stale)
					return updated;
				const idx = items.value.findIndex(item => item.id === id);
				if (admit && !admit(updated))
					return idx === -1 ? updated : items.value[idx]!;
				if (idx !== -1)
					items.value[idx] = updated;
				onSuccess?.();
				return updated;
			},
			{
				errorRef,
				flight,
				onError: () => {
					const idx = items.value.findIndex(item => item.id === id);
					if (idx !== -1)
						items.value[idx] = original;
				},
			},
		);
	}

	/**
	 * Optimistically removes an item from the list, rolling back on failure.
	 * Splices the item out immediately, then confirms via API. On error, re-inserts.
	 */
	async function optimisticDelete<T extends { id: number }>(
		config: OptimisticDeleteConfig<T>,
	): Promise<boolean | null> {
		const { items, id, apiCall, errorRef, entityLabel, onSuccess, flight = unguarded } = config;

		const index = items.value.findIndex(item => item.id === id);
		if (index === -1) {
			errorRef.value = `${entityLabel} not found`;
			return null;
		}

		const removed = structuredClone(toRaw(items.value[index]!));
		items.value.splice(index, 1);

		return executeAction(
			async () => {
				await apiCall();
				if (flight.current)
					onSuccess?.();
				return true;
			},
			{
				errorRef,
				flight,
				onError: () => {
					// Re-find safe insertion point (list may have shifted during async call)
					const insertIdx = Math.min(index, items.value.length);
					items.value.splice(insertIdx, 0, removed);
				},
			},
		);
	}

	return { optimisticUpdate, optimisticDelete };
}
