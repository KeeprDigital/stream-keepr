import type { ConsumedEventData } from '~/modules/event-data/resync';
import { useConsumedEventData } from '~/modules/event-data/resync';

interface StoreLoadEntry {
	/** The Event Data this entry loads, which the page consumes while mounted. */
	consumes: ConsumedEventData;
	isLoaded: () => boolean;
	load: (eventId: number) => Promise<unknown>;
}

/**
 * Standardised loading pattern for event-scoped pages.
 *
 * Handles:
 * - `eventId` computed from the event store
 * - Parallel loading of stores when the event changes (skipping already-loaded stores)
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
			: 'Unable to load this page';
	}

	async function loadPage(id: number) {
		const generation = ++loadGeneration;
		loading.value = true;
		initialError.value = null;

		try {
			const pending = entries
				.filter(e => !e.isLoaded())
				.map(e => e.load(id));

			if (pending.length) {
				const results = await Promise.all(pending);
				if (results.includes(null))
					throw new Error('Unable to load this page');
			}

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

	return { eventId, initialLoading, loading, initialError, retry };
}
