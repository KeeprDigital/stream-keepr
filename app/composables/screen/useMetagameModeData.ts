import type {
	ArchetypeBreakdownResponse,
	CardBreakdownResponse,
} from '~~/shared/types/metagame';
import { buildMetagameScopeQuery, useMetagameClient } from '~/modules/metagame/client';
import { useScreenModePagination } from '~/modules/screen-mode/pagination';

type MetagameDisplayRow = ArchetypeBreakdownResponse['entries'][number] | CardBreakdownResponse['entries'][number];

export function useMetagameModeData() {
	const { screen, eventId, interactive } = useScreenContext();
	const config = useScreenModeConfig('metagame');

	const playerStore = usePlayerStore();
	const screenStore = useScreenStore();
	const metagameClient = useMetagameClient();

	const displayData = useBroadcastDisplayData<{
		archetypeData: ArchetypeBreakdownResponse | null;
		cardData: CardBreakdownResponse | null;
	}>({ initialData: { archetypeData: null, cardData: null } });
	const loading = displayData.loading;
	const error = displayData.error;

	// ── Response data ──
	const archetypeData = computed(() => displayData.data.value.archetypeData);
	const cardData = computed(() => displayData.data.value.cardData);

	// ── Active data based on viewMode ──
	const activeData = computed(() => {
		switch (config.value.viewMode) {
			case 'archetype':
				return archetypeData.value;
			case 'cards':
				return cardData.value;
			default:
				// Treat unknown/removed view modes (e.g. legacy 'colors') as 'archetype'
				return archetypeData.value;
		}
	});

	// ── Header ──
	const headerText = computed(() => {
		if (config.value.headerText)
			return config.value.headerText;

		const prefix = config.value.scope === 'topN'
			? `Top ${config.value.topN}`
			: config.value.scope === 'playerList'
				? 'List'
				: 'Full Field';

		switch (config.value.viewMode) {
			case 'cards':
				return config.value.archetypeFilter
					? `${prefix} Cards: ${config.value.archetypeFilter}`
					: `${prefix} Most Played Cards`;
			case 'archetype':
			default:
				return `${prefix} Metagame`;
		}
	});

	// ── Display Rows (paginated) ──
	const displayRows = computed<MetagameDisplayRow[]>(() => {
		const data = activeData.value;
		if (!data)
			return [];
		return 'entries' in data ? data.entries : [];
	});

	// ── Pagination ──
	const {
		pageData,
		totalPages,
		currentPage,
		setPage,
		nextPage,
		prevPage,
	} = useScreenModePagination({
		rows: displayRows,
		pageSize: computed(() => config.value.pageSize),
		currentPage: computed(() => config.value.currentPage ?? 1),
		autoPageEnabled: computed(() => config.value.autoPageEnabled),
		autoPageIntervalMs: computed(() => config.value.autoPageIntervalMs),
		rotationAnchor: computed(() => config.value.rotationAnchor),
		persistPage: (page) => {
			if (interactive.value && screen.value) {
				void Promise.resolve(screenStore.updateModeConfig(
					eventId.value!,
					screen.value.id,
					'metagame',
					{ currentPage: page },
				)).catch(() => {});
			}
		},
		persistRotationAnchor: (anchor) => {
			if (interactive.value && screen.value) {
				void Promise.resolve(screenStore.updateModeConfig(
					eventId.value!,
					screen.value.id,
					'metagame',
					{ rotationAnchor: anchor },
				)).catch(() => {});
			}
		},
	});

	// ── Query params builder ──
	function buildScopeQuery() {
		return buildMetagameScopeQuery({
			scope: config.value.scope,
			topN: config.value.topN,
			playerListId: config.value.playerListId,
		});
	}

	// ── Data Loading ──
	async function fetchData() {
		const evtId = eventId.value;
		if (!evtId) {
			error.value = 'No event loaded';
			displayData.clear();
			return;
		}

		await displayData.refresh(async () => {
			const scopeQuery = buildScopeQuery();
			const current = displayData.data.value;

			switch (config.value.viewMode) {
				case 'cards':
					return {
						...current,
						cardData: await metagameClient.loadCardBreakdown(evtId, scopeQuery, {
							sortBy: config.value.cardSortBy,
							limit: config.value.limit,
							archetype: config.value.archetypeFilter,
						}),
					};
				case 'archetype':
				default:
					return {
						...current,
						archetypeData: await metagameClient.loadArchetypeBreakdown(evtId, scopeQuery, { sortBy: config.value.sortBy }),
					};
			}
		}, 'Failed to load metagame data');
	}

	// ── Empty State ──
	const isEmpty = computed(() => !loading.value && displayRows.value.length === 0);
	const emptyMessage = computed(() => {
		if (!playerStore.isLoaded || playerStore.players.length === 0) {
			return 'No players in this event';
		}
		return 'No metagame data available';
	});

	// ── Watchers ──
	// Refetch when viewMode, scope, or filter params change
	watch(
		() => [
			config.value.viewMode,
			config.value.scope,
			config.value.topN,
			config.value.playerListId,
			config.value.archetypeFilter,
			config.value.sortBy,
			config.value.cardSortBy,
			config.value.limit,
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
		archetypeData,
		cardData,
		displayRows,
		pageData,
		currentPage,
		totalPages,
		nextPage,
		prevPage,
		setPage,
		fetchData,
	};
}
