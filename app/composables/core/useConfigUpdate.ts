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
	const hasCommitted = ref(false);
	const pendingUpdates = ref<U>({} as U);
	const localOverrides = ref<U>({} as U);
	/** Each refused field's value, kept for retry, with the sentence that refused it — newest last. */
	const refusedFields = ref<Record<string, { value: unknown; message: string }>>({});

	/**
	 * A failure is outstanding for as long as an edit it refused is (#611): a later
	 * request landing — for an unrelated field — says nothing about it. Only a newer
	 * edit of the refused field, or a retry, settles it. The sentence quoted is the
	 * newest refusal still outstanding, so it names a slot that still needs repair.
	 */
	const saveError = computed<string | null>(() =>
		Object.values(refusedFields.value).at(-1)?.message ?? null);

	/**
	 * The save's answer as one state a surface can show (#381): `committed` is an
	 * affirmative fact, not the mere absence of `saving` — which is exactly what
	 * an author who looked away during a multi-second save cannot distinguish
	 * from a failure whose toast they missed. `idle` only before the first edit;
	 * once something has been saved the surface keeps saying so.
	 *
	 * An outstanding failure outranks `saving` (#611): another field's save in
	 * flight will not land the refused edit, and only `failed` offers its Retry.
	 */
	const saveState = computed<'idle' | 'saving' | 'committed' | 'failed'>(() => {
		if (saveError.value !== null)
			return 'failed';
		if (saving.value)
			return 'saving';
		return hasCommitted.value ? 'committed' : 'idle';
	});

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

	/**
	 * Whether the operator has replaced the value a settling request sent for `key` —
	 * queued a newer one, or no longer shows it. The request's outcome then no
	 * longer speaks for that field.
	 */
	function isSuperseded(key: string, sentValue: unknown): boolean {
		return pendingHasKey(key)
			|| !Object.hasOwn(localOverrides.value, key)
			|| (localOverrides.value as Record<string, unknown>)[key] !== sentValue;
	}

	function clearOverridesForSettledKeys(updates: U) {
		const currentOverrides = { ...localOverrides.value } as Record<string, unknown>;
		for (const [key, sentValue] of Object.entries(updates)) {
			if (!isSuperseded(key, sentValue))
				delete currentOverrides[key];
		}
		localOverrides.value = currentOverrides as U;
	}

	/**
	 * Keep for retry only what the refused request still speaks for (#611). A field
	 * edited again while it was in flight has a newer write of its own; holding the
	 * older value would let a retry put it back over the newer one.
	 */
	function recordRefusedKeys(updates: U, message: string) {
		const refused = { ...refusedFields.value };
		for (const [key, sentValue] of Object.entries(updates)) {
			if (isSuperseded(key, sentValue))
				continue;
			// Re-inserted so the newest refusal stays last.
			delete refused[key];
			refused[key] = { value: sentValue, message };
		}
		refusedFields.value = refused;
	}

	function forgetRefusedKeys(keys: string[]) {
		const refused = { ...refusedFields.value };
		for (const key of keys)
			delete refused[key];
		refusedFields.value = refused;
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
					// Quote the failure's own sentence where it wrote one — a refusal
					// names the slot to repair — and keep the caller's static wording
					// for a failure that carries none. The widening #286 made safe.
					error: ({ message }) => ({
						title: 'Error',
						description: message || errorMessage,
						color: 'error',
					}),
					onFailure: ({ message }) => {
						recordRefusedKeys(updates, message || errorMessage);
					},
				},
			));
		}
		finally {
			inFlight.value = false;
		}

		if (saved) {
			hasCommitted.value = true;
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
		forgetRefusedKeys(Object.keys(updates));
		// Apply to local overrides immediately — UI updates this tick
		localOverrides.value = { ...localOverrides.value, ...updates };
		// Queue for the debounced API save
		pendingUpdates.value = { ...pendingUpdates.value, ...updates };
		saveDebounce.schedule();
	}

	async function retry() {
		const refused = Object.entries(refusedFields.value);
		if (refused.length === 0)
			return;
		const retried = Object.fromEntries(refused.map(([key, { value }]) => [key, value])) as U;
		pendingUpdates.value = { ...retried, ...pendingUpdates.value };
		refusedFields.value = {};
		saving.value = true;
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

	return { config, saving, saveState, saveError, updateConfig, retry };
}
