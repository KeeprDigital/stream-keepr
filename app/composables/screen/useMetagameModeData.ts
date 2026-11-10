import type {
	ArchetypeBreakdownResponse,
	CardBreakdownResponse,
} from '~~/shared/types/metagame';
import type { ScreenOutputMetagameResponse } from '~~/shared/types/screenOutputReads';
import type { MetagameChartBar } from '~~/shared/utils/metagameChart';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { eventConversionTarget } from '~~/shared/conversionTarget';
import { offeredMetagameScope } from '~~/shared/utils/metagame';
import { projectMetagameChart } from '~~/shared/utils/metagameChart';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

type MetagameDisplayRow = ArchetypeBreakdownResponse['entries'][number] | CardBreakdownResponse['entries'][number];

export function useMetagameModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'metagame');

	const outputReads = useScreenOutputReads(context);
	const eventStore = useEventStore();
	const game = useScreenCardGame(context);
	// The scope read: one the Card Game does not offer reads every Player (ADR-0074).
	const scope = computed(() => offeredMetagameScope(game.value, config.value.scope));

	// The server derives the breakdown from the saved configuration (#604) and,
	// for an archetype breakdown, its Event's Conversion Target (ADR-0061), so the
	// read changes with what it depends on. An `event:updated` folded into the
	// held Event context changes the target.
	const freshness = useScreenModeFreshness<ScreenOutputMetagameResponse | null>({
		hearing: useScreenModeHearing(context, 'metagame', () => config.value),
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
			config.value.viewMode === 'cards'
				? null
				: eventConversionTarget(eventStore.displayEvent),
		]),
		read: () => outputReads.metagame(),
		initialData: null,
		errorMessage: 'Failed to load metagame data',
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

		const prefix = scope.value === 'topN'
			? `Top ${config.value.topN}`
			: scope.value === 'minPoints'
				? `${config.value.minPoints}+ Points`
				: scope.value === 'playerList'
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
		pageSize,
		totalPages,
		currentPage,
		setPage,
		nextPage,
		prevPage,
	} = usePaginatedScreenMode(context, { mode: 'metagame', config, rows: pagedRows });

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
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		/** The Card Game it renders for, whose Metagame decides the columns it shows. */
		game,
		loading,
		/** Whether its rows are a read's answer, or it selects nothing: false only while its first read is in flight. */
		answered: freshness.answered,
		error,
		isEmpty,
		emptyMessage,
		headerText,
		archetypeData,
		cardData,
		displayRows,
		chartBars,
		pageData,
		pageSize,
		rowCount,
		currentPage,
		totalPages,
		nextPage,
		prevPage,
		setPage,
	};
}
