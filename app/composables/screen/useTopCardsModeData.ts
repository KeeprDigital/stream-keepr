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
	// A Page Rotation over the grid's rows, so each page holds whole rows of
	// `columns` cards and `rowsPerPage` (the declared page size) counts them.
	const gridRows = computed<RankedTopCard[][]>(() => {
		const columns = Math.max(1, config.value.columns);
		const rows: RankedTopCard[][] = [];
		entries.value.forEach((entry, index) => {
			if (index % columns === 0)
				rows.push([]);
			rows.at(-1)!.push({ entry, rank: index + 1 });
		});
		return rows;
	});
	const {
		pageData,
		totalPages,
		currentPage,
		setPage,
		nextPage,
		prevPage,
	} = usePaginatedScreenMode({ mode: 'top-cards', config, rows: gridRows });
	const pageEntries = computed(() => pageData.value.flat());

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

	// ── Empty State ──
	const isEmpty = computed(() => !loading.value && entries.value.length === 0);
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
		currentPage,
		totalPages,
		setPage,
		nextPage,
		prevPage,
	};
}
