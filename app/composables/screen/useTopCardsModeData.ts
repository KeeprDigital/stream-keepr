import type { CardBreakdownEntry, CardBreakdownResponse } from '~~/shared/types/metagame';
import { metagameBreakdownDependencies } from '~/modules/metagame/screenDependencies';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

/** A card in the grid with its rank across the whole ranking, not just its page. */
export interface RankedTopCard {
	entry: CardBreakdownEntry;
	rank: number;
}

export function useTopCardsModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('top-cards');
	const outputReads = useScreenOutputReads();

	// The server derives the breakdown from the saved configuration (#604), so
	// the read changes with the configuration fields it depends on.
	const freshness = useScreenModeFreshness<CardBreakdownResponse | null>({
		eventId,
		source: () => outputReads.scopeKey.value && JSON.stringify([
			outputReads.scopeKey.value,
			config.value.scope,
			config.value.topN,
			config.value.playerListId,
			config.value.archetypeFilter,
			config.value.board,
			config.value.sortBy,
			config.value.limit,
			config.value.excludedCardTypes,
		]),
		read: () => outputReads.topCards(),
		initialData: null,
		errorMessage: 'Failed to load top cards data',
		dependsOn: metagameBreakdownDependencies(() => config.value),
	});
	const loading = freshness.loading;
	const error = freshness.error;

	const cardData = computed(() => freshness.data.value);
	const entries = computed(() => cardData.value?.entries ?? []);

	// ── Pagination ──
	// A Page Rotation over the ranked cards, `cardsPerPage` (the declared page
	// size) a page. Columns are the Screen's to lay out in the space it measures;
	// they never change which cards a page holds (ADR-0053).
	const rankedCards = computed(() => entries.value.map((entry, index) => ({ entry, rank: index + 1 })));
	const {
		rowCount,
		pageData,
		totalPages,
		currentPage,
		setPage,
		nextPage,
		prevPage,
	} = usePaginatedScreenMode({ mode: 'top-cards', config, rows: rankedCards });
	const pageEntries = computed<RankedTopCard[]>(() => pageData.value);
	/** The cards a full page holds, which every page lays out as, so a short last page keeps its size. */
	const pageCapacity = computed(() => Math.max(1, Math.min(config.value.cardsPerPage, entries.value.length)));

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
			? `${prefix}Most Played Cards: ${config.value.archetypeFilter}`
			: `${prefix}Most Played Cards`;
	});

	// ── Empty State ──
	const isEmpty = computed(() => freshness.answered.value && entries.value.length === 0);
	// Read off the breakdown: an output holds no roster to count (#604).
	const emptyMessage = computed(() => {
		if (!cardData.value?.totalDecks) {
			return 'No players in this event';
		}
		return 'No card data available';
	});

	return {
		config,
		loading,
		error,
		isEmpty,
		emptyMessage,
		headerText,
		cardData,
		entries,
		pageEntries,
		pageCapacity,
		rowCount,
		currentPage,
		totalPages,
		setPage,
		nextPage,
		prevPage,
	};
}
