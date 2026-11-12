import type { ConsumedEventData } from '~/modules/event-data/resync';
import { useConsumedEventData } from '~/modules/event-data/resync';

interface StoreLoadEntry {
	/** The Event Data this entry loads, which the page consumes while mounted. */
	consumes: ConsumedEventData;
	isLoaded: () => boolean;
	/** Whether its store has a load in flight, the page's own or anyone else's. */
	isLoading: () => boolean;
	/**
	 * Loads it, raising a failure (`{ failure: 'raise' }`). A load that answers
	 * without leaving it loaded was superseded, which is not a failure.
	 */
	load: (eventId: number) => Promise<unknown>;
}

const UNABLE_TO_LOAD = 'Unable to load this page';

/**
 * Standardised loading pattern for event-scoped pages.
 *
 * Handles:
 * - `eventId` computed from the event store
 * - Parallel loading of stores when the event changes (skipping already-loaded stores)
 * - A load a newer load of the same Event Data superseded: the page keeps loading
 *   until that one settles, and shows its data rather than an error (#1145)
 * - Gap-free `initialLoading` computed based on `!isLoaded` flags
 * - Optional sequential `afterLoad` for dependent fetches (e.g. matches after rounds)
 * - Consuming each entry's Event Data while mounted, so Reconnect Resync re-reads
 *   what the page shows and a revisit re-reads what was missed while away (#610)
 */
export function useEventPageLoading(
	entries: StoreLoadEntry[],
	afterLoad?: (eventId: number) => Promise<void>,
) {
	useConsumedEventData(entries.map(entry => entry.consumes));
	const eventStore = useEventStore();
	const eventId = computed<number>(() => eventStore.eventId ?? 0);
	const loading = ref(false);
	const initialError = ref<string | null>(null);
	let loadGeneration = 0;

	const initialLoading = computed(() => loading.value || (!initialError.value && entries.some(e => !e.isLoaded())));

	function errorMessage(error: unknown): string {
		return error instanceof Error && error.message.trim()
			? error.message
			: UNABLE_TO_LOAD;
	}

	/**
	 * Loads one entry, failing when the page cannot show it. Its own load raises a
	 * failure. One superseded leaves the entry to the store's newer load, so the page
	 * waits until nothing is loading it: by then it is loaded, or that load failed too.
	 */
	async function loadEntry(entry: StoreLoadEntry, id: number) {
		try {
			await entry.load(id);
		}
		catch {
			throw new Error(UNABLE_TO_LOAD);
		}
		if (!entry.isLoaded())
			await until(entry.isLoading).toBe(false);
		if (!entry.isLoaded())
			throw new Error(UNABLE_TO_LOAD);
	}

	async function loadPage(id: number) {
		const generation = ++loadGeneration;
		loading.value = true;
		initialError.value = null;

		try {
			await Promise.all(entries
				.filter(e => !e.isLoaded())
				.map(e => loadEntry(e, id)));

			if (generation === loadGeneration && afterLoad)
				await afterLoad(id);
		}
		catch (error) {
			if (generation === loadGeneration)
				initialError.value = errorMessage(error);
		}
		finally {
			if (generation === loadGeneration)
				loading.value = false;
		}
	}

	async function retry() {
		if (eventId.value)
			await loadPage(eventId.value);
	}

	watch(eventId, async (id, _previousId, onCleanup) => {
		if (!id) {
			loadGeneration++;
			loading.value = false;
			initialError.value = null;
			return;
		}

		onCleanup(() => {
			loadGeneration++;
		});

		await loadPage(id);
	}, { immediate: true });

	return {
		eventId,
		initialLoading,
		loading,
		initialError,
		retry,
	};
}
