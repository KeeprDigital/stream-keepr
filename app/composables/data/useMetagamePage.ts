import type { WatchSource } from 'vue';

/**
 * Shared scaffolding for the metagame pages: owns the summary fetch, the
 * combined page fetch, and the watches that refetch when the metagame scope
 * or underlying player data changes.
 */
export function useMetagamePage(
	fetchSection: () => Promise<void>,
	options: { extraScopeWatchSources?: WatchSource[] } = {},
) {
	const eventStore = useEventStore();
	const playerStore = usePlayerStore();
	const metagameStore = useMetagameStore();
	const { runRequest } = useRequestFeedback();

	const summaryLoading = ref(false);

	async function fetchSummary() {
		if (!eventStore.eventId)
			return;

		await runRequest(
			async () => {
				await metagameStore.loadSummary(eventStore.eventId!);
				if (metagameStore.error)
					throw new Error(metagameStore.error);
				return true;
			},
			{
				latestKey: 'summary',
				loadingRef: summaryLoading,
				success: false,
				error: ({ message }) => ({ title: message, color: 'error' }),
			},
		);
	}

	async function fetchPageData() {
		await Promise.all([fetchSummary(), fetchSection()]);
	}

	watch(
		[
			() => metagameStore.scope,
			() => metagameStore.topN,
			() => metagameStore.playerListId,
			...(options.extraScopeWatchSources ?? []),
		],
		() => fetchPageData(),
	);

	watch(() => playerStore.dataVersion, () => fetchPageData());
	watch(() => metagameStore.invalidationVersion, () => fetchPageData());

	return {
		summaryLoading,
		fetchPageData,
	};
}
