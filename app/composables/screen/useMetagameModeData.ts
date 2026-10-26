import type {
	ArchetypeBreakdownResponse,
	CardBreakdownResponse,
} from '~~/shared/types/metagame';
import type { ScreenOutputMetagameResponse } from '~~/shared/types/screenOutputReads';
import type { MetagameChartBar } from '~~/shared/utils/metagameChart';
import { projectMetagameChart } from '~~/shared/utils/metagameChart';
import { metagameBreakdownDependencies } from '~/modules/metagame/screenDependencies';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

type MetagameDisplayRow = ArchetypeBreakdownResponse['entries'][number] | CardBreakdownResponse['entries'][number];

export function useMetagameModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('metagame');

	const outputReads = useScreenOutputReads();

	// The server derives the breakdown from the saved configuration (#604), so
	// the read changes with the configuration fields it depends on.
	const freshness = useScreenModeFreshness<ScreenOutputMetagameResponse | null>({
		eventId,
		source: () => outputReads.scopeKey.value && JSON.stringify([
			outputReads.scopeKey.value,
			config.value.viewMode,
			config.value.scope,
			config.value.topN,
			config.value.minPoints,
			config.value.playerListId,
			config.value.archetypeFilter,
			config.value.sortBy,
			config.value.cardSortBy,
			config.value.limit,
			config.value.archetypeLimit,
		]),
		read: () => outputReads.metagame(),
		initialData: null,
		errorMessage: 'Failed to load metagame data',
		dependsOn: metagameBreakdownDependencies(() => config.value),
	});
	const loading = freshness.loading;
	const error = freshness.error;

	// ── Response data ──
	const archetypeData = computed<ArchetypeBreakdownResponse | null>(() => {
		const read = freshness.data.value;
		return read && read.viewMode !== 'cards'
			? read.breakdown
			: null;
	});
	const cardData = computed<CardBreakdownResponse | null>(() => {
		const read = freshness.data.value;
		return read?.viewMode === 'cards'
			? read.breakdown
			: null;
	});

	// ── Active data based on viewMode ──
	const activeData = computed(() => {
		switch (config.value.viewMode) {
			case 'archetype':
			case 'chart':
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
			: config.value.scope === 'minPoints'
				? `${config.value.minPoints}+ Points`
				: config.value.scope === 'playerList'
					? 'List'
					: 'Full Field';

		switch (config.value.viewMode) {
			case 'cards':
				return config.value.archetypeFilter
					? `${prefix} Cards: ${config.value.archetypeFilter}`
					: `${prefix} Most Played Cards`;
			case 'archetype':
			case 'chart':
			default:
				return `${prefix} Metagame`;
		}
	});

	// ── Display Rows (paginated) ──
	const displayRows = computed<MetagameDisplayRow[]>(() => {
		const data = activeData.value;
		if (!data)
			return [];
		return 'entries' in data
			? data.entries
			: [];
	});

	// ── Chart ──
	// The archetype breakdown, drawn as bars; empty outside the chart display.
	const chartBars = computed<MetagameChartBar[]>(() =>
		config.value.viewMode === 'chart' && archetypeData.value
			? projectMetagameChart(archetypeData.value)
			: [],
	);

	// ── Pagination ──
	// A chart is one page: it draws every bar at once (Other folds the rest),
	// so it gives the Page Rotation nothing to page.
	const pagedRows = computed<MetagameDisplayRow[]>(() =>
		config.value.viewMode === 'chart'
			? []
			: displayRows.value,
	);
	const {
		rowCount,
		pageData,
		totalPages,
		currentPage,
		setPage,
		nextPage,
		prevPage,
	} = usePaginatedScreenMode({ mode: 'metagame', config, rows: pagedRows });

	// ── Empty State ──
	const isEmpty = computed(() => freshness.answered.value && displayRows.value.length === 0);
	// Read off the breakdown: an output holds no roster to count (#604).
	const emptyMessage = computed(() => {
		const fieldSize = config.value.viewMode === 'cards'
			? cardData.value?.totalDecks
			: archetypeData.value?.totalPlayers;
		if (!fieldSize) {
			return 'No players in this event';
		}
		return 'No metagame data available';
	});

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
		chartBars,
		pageData,
		rowCount,
		currentPage,
		totalPages,
		nextPage,
		prevPage,
		setPage,
	};
}
