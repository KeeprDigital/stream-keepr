import { tryOnScopeDispose } from '@vueuse/core';
import { createCancelableDebounce } from '~/utils/cancelableDebounce';
import { registerPendingEditFlush } from '~/utils/eventStores';

// U is the update payload type — defaults to Partial<T> but can include `null` for "delete" semantics
interface UseConfigUpdateOptions<T, U extends Record<string, any> = Partial<T>> {
	/** How to read current config from the store */
	getStoreConfig: () => Partial<T>;
	/** How to persist updates to the store */
	saveToStore: (updates: U) => Promise<any>;
	/** Default config values */
	defaults: T;
	/** Debounce delay in ms before flushing to API. Default: 300 */
	debounceMs?: number;
	/** Maximum time in ms before forcing a flush. Default: 1000 */
	maxWaitMs?: number;
	/** Error toast description */
	errorMessage?: string;
}

/**
 * Generic composable for config updates with local-first UI.
 *
 * Maintains a `localOverrides` layer so every change is reflected in the
 * returned `config` computed immediately, while API saves are debounced.
 *
 * @typeParam T - The config type (values are non-null)
 * @typeParam U - The update payload type (may include null to signal "delete key")
 */
export function useConfigUpdate<T extends Record<string, any>, U extends Record<string, any> = Partial<T>>(
	options: UseConfigUpdateOptions<T, U>,
) {
	const {
		getStoreConfig,
		saveToStore,
		defaults,
		debounceMs = 300,
		maxWaitMs = 1000,
		errorMessage = 'Failed to update config',
	} = options;

	const { runRequest } = useRequestFeedback();

	const saving = ref(false);
	const inFlight = ref(false);
	const saveError = ref<string | null>(null);
	const pendingUpdates = ref<U>({} as U);
	const failedUpdates = ref<U>({} as U);
	const localOverrides = ref<U>({} as U);

	// Merged config: defaults < store < local overrides.
	// Null values from overrides are treated as "unset" (filtered out).
	const config = computed<T>(() => {
		const merged = {
			...defaults,
			...getStoreConfig(),
			...localOverrides.value,
		};
		return Object.fromEntries(
			Object.entries(merged).filter(([, v]) => v !== null),
		) as T;
	});

	function pendingHasKey(key: string): boolean {
		return Object.hasOwn(pendingUpdates.value, key);
	}

	function clearOverridesForSettledKeys(updates: U) {
		const currentOverrides = { ...localOverrides.value } as Record<string, unknown>;
		for (const key of Object.keys(updates)) {
			const sentValue = (updates as Record<string, unknown>)[key];
			if (!pendingHasKey(key)
				&& Object.hasOwn(currentOverrides, key)
				&& currentOverrides[key] === sentValue) {
				delete currentOverrides[key];
			}
		}
		localOverrides.value = currentOverrides as U;
	}

	async function flushPendingUpdates() {
		if (inFlight.value)
			return;

		if (Object.keys(pendingUpdates.value).length === 0) {
			if (!inFlight.value)
				saving.value = false;
			return;
		}

		// Snapshot what we're about to send
		const updates = { ...pendingUpdates.value };
		pendingUpdates.value = {};
		inFlight.value = true;

		let saved = false;
		try {
			saved = Boolean(await runRequest(
				async () => {
					const result = await saveToStore(updates);
					if (result === null || result === false)
						throw new Error(errorMessage);
					return true;
				},
				{
					error: {
						title: 'Error',
						description: errorMessage,
						color: 'error',
					},
					onFailure: ({ message }) => {
						saveError.value = message || errorMessage;
						failedUpdates.value = { ...failedUpdates.value, ...updates };
					},
				},
			));
		}
		finally {
			inFlight.value = false;
		}

		if (saved) {
			saveError.value = null;
			// Clear overrides for keys that were successfully saved,
			// but preserve any NEW overrides that arrived while the request was in flight.
			clearOverridesForSettledKeys(updates);
		}

		if (Object.keys(pendingUpdates.value).length > 0) {
			await flushPendingUpdates();
			return;
		}

		if (!inFlight.value)
			saving.value = false;
	}

	const saveDebounce = createCancelableDebounce(flushPendingUpdates, debounceMs, maxWaitMs);

	function updateConfig(updates: U) {
		saving.value = true;
		saveError.value = null;
		const failed = { ...failedUpdates.value } as Record<string, unknown>;
		for (const key of Object.keys(updates))
			delete failed[key];
		failedUpdates.value = failed as U;
		// Apply to local overrides immediately — UI updates this tick
		localOverrides.value = { ...localOverrides.value, ...updates };
		// Queue for the debounced API save
		pendingUpdates.value = { ...pendingUpdates.value, ...updates };
		saveDebounce.schedule();
	}

	async function retry() {
		if (Object.keys(failedUpdates.value).length === 0)
			return;
		pendingUpdates.value = { ...failedUpdates.value, ...pendingUpdates.value };
		failedUpdates.value = {} as U;
		saving.value = true;
		saveError.value = null;
		await flushPendingUpdates();
	}

	/**
	 * Spend the pending edit rather than discard it, at whichever of the two moments
	 * arrives first.
	 *
	 * Every change here is applied to `localOverrides` the moment it is made, so the
	 * operator has already been told it is saved. A disposal that cancelled the
	 * debounced write — which is what this used to do — made that a lie for anyone
	 * who navigated away inside the window, and silently: the setting reverted on the
	 * next load with nothing having reported a failure (#308).
	 *
	 * Disposal alone is not early enough. Leaving an Event runs the route middleware,
	 * which resets the Event-scoped stores *before* the page unmounts — so a write
	 * flushed on disposal reaches a store that no longer holds the Screen it names
	 * and is refused. `registerPendingEditFlush` is the earlier moment; the disposal
	 * covers every ending that is not a navigation, such as a panel closing.
	 *
	 * Nothing else is cleared. `pendingUpdates` in particular must survive, because a
	 * disposal during an in-flight save finds `flushPendingUpdates` early-returning,
	 * and the queue is what that save's own continuation picks up.
	 */
	const unregisterPendingEditFlush = registerPendingEditFlush(() => saveDebounce.flushIfPending());

	tryOnScopeDispose(() => {
		unregisterPendingEditFlush();
		saveDebounce.flushIfPending();
	});

	return { config, saving, saveError, updateConfig, retry };
}
