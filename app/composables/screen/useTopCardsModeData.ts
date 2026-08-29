import type { CardBreakdownResponse } from '~~/shared/types/metagame';
import { useMetagameClient } from '~/modules/metagame/client';

export function useTopCardsModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('top-cards');

	const playerStore = usePlayerStore();
	const metagameClient = useMetagameClient();

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
		const evtId = eventId.value;
		if (!evtId) {
			error.value = 'No event loaded';
			displayData.clear();
			return;
		}

		await displayData.refresh(async () => ({
			cardData: await metagameClient.loadCardBreakdown(
				evtId,
				{
					scope: config.value.scope,
					topN: config.value.topN,
					playerListId: config.value.playerListId,
				},
				{
					sortBy: config.value.sortBy,
					limit: config.value.limit,
					board: config.value.board,
					archetype: config.value.archetypeFilter,
					excludeTypes: config.value.excludedCardTypes,
				},
			),
		}), 'Failed to load top cards data');
	}

	// ── Empty State ──
	const isEmpty = computed(() => !loading.value && entries.value.length === 0);
	const emptyMessage = computed(() => {
		if (!playerStore.isLoaded || playerStore.players.length === 0) {
			return 'No players in this event';
		}
		return 'No card data available';
	});

	// ── Watchers ──
	// Refetch when any scope, filter, or ranking param changes
	watch(
		() => [
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
