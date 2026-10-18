import type { CardBreakdownResponse } from '~~/shared/types/metagame';

export function useTopCardsModeData() {
	const config = useScreenModeConfig('top-cards');

	const playerStore = usePlayerStore();
	const outputReads = useScreenOutputReads();

	const displayData = useBroadcastDisplayData<{ cardData: CardBreakdownResponse | null }>({
		initialData: { cardData: null },
	});
	const loading = displayData.loading;
	const error = displayData.error;

	const cardData = computed(() => displayData.data.value.cardData);
	const entries = computed(() => cardData.value?.entries ?? []);

	// ── Header ──
	const headerText = computed(() => {
		if (config.value.headerText)
			return config.value.headerText;

		const prefix = config.value.scope === 'topN'
			? `Top ${config.value.topN} `
			: config.value.scope === 'playerList'
				? 'List '
				: '';

		return config.value.archetypeFilter
			? `${prefix}Top Cards: ${config.value.archetypeFilter}`
			: `${prefix}Most Played Cards`;
	});

	// ── Data Loading ──
	async function fetchData() {
		if (!outputReads.scope.value) {
			error.value = 'No event loaded';
			displayData.clear();
			return;
		}

		// Derived on the server from the saved configuration (#604).
		await displayData.refresh(async () => ({
			cardData: await outputReads.topCards(),
		}), 'Failed to load top cards data');
	}

	// ── Empty State ──
	const isEmpty = computed(() => !loading.value && entries.value.length === 0);
	// Read off the breakdown: an output holds no roster to count (#604).
	const emptyMessage = computed(() => {
		if (!cardData.value?.totalDecks) {
			return 'No players in this event';
		}
		return 'No card data available';
	});

	// ── Watchers ──
	// Refetch when any scope, filter, or ranking param changes
	watch(
		() => [
			outputReads.scopeKey.value,
			config.value.scope,
			config.value.topN,
			config.value.playerListId,
			config.value.archetypeFilter,
			config.value.board,
			config.value.sortBy,
			config.value.limit,
			config.value.excludedCardTypes,
		],
		() => fetchData(),
		{ immediate: true },
	);

	// Refetch when any player data changes (realtime updates, syncs, edits)
	watch(
		() => playerStore.dataVersion,
		() => fetchData(),
	);

	return {
		config,
		loading,
		error,
		isEmpty,
		emptyMessage,
		headerText,
		cardData,
		entries,
		fetchData,
	};
}
