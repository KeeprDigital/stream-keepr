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
}

interface OptimisticDeleteConfig<T> {
	items: Ref<T[]>;
	id: number;
	apiCall: () => Promise<unknown>;
	errorRef: Ref<string | null>;
	entityLabel: string;
	onSuccess?: () => void;
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
		const { items, id, updates, apiCall, errorRef, entityLabel, onSuccess } = config;

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
				const idx = items.value.findIndex(item => item.id === id);
				if (idx !== -1)
					items.value[idx] = updated;
				onSuccess?.();
				return updated;
			},
			{
				errorRef,
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
		const { items, id, apiCall, errorRef, entityLabel, onSuccess } = config;

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
				onSuccess?.();
				return true;
			},
			{
				errorRef,
				onError: () => {
					// Re-find safe insertion point (list may have shifted during async call)
					const insertIdx = Math.min(index, items.value.length);
					items.value.splice(insertIdx, 0, removed);
				},
			},
		);
	}

	return { executeAction, optimisticUpdate, optimisticDelete };
}
