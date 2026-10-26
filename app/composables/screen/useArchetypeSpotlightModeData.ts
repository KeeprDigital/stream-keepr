import type { ScreenOutputArchetypePilot, ScreenOutputArchetypeSpotlightResponse } from '~~/shared/types/screenOutputReads';
import { archetypeSpotlightScreenQuery } from '~~/shared/utils/metagameQuery';
import { formatPlayerRecord } from '~~/shared/utils/playerRecord';
import { metagameBreakdownDependencies } from '~/modules/metagame/screenDependencies';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { usePaginatedScreenMode } from '~/modules/screen-mode/pagination';

/** The Archetype Spotlight Screen's data (#761): one Archetype's pilots, numbers and top cards in a Metagame scope. */
export function useArchetypeSpotlightModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('archetype-spotlight');
	const outputReads = useScreenOutputReads();
	const eventStore = useEventStore();

	// The server derives the read from the saved configuration (#604), so the
	// read changes with what it asks: the archetype detail query, and the
	// projection's card fields.
	const freshness = useScreenModeFreshness<ScreenOutputArchetypeSpotlightResponse | null>({
		eventId,
		source: () => {
			const request = archetypeSpotlightScreenQuery(config.value);
			return outputReads.scopeKey.value && request
				? JSON.stringify([
						outputReads.scopeKey.value,
						request,
						config.value.cardLimit,
						config.value.excludedCardTypes,
					])
				: null;
		},
		read: () => outputReads.archetypeSpotlight(),
		initialData: null,
		errorMessage: 'Failed to load archetype spotlight',
		// The archetype detail is a Metagame read over the same Event Data.
		dependsOn: metagameBreakdownDependencies(() => config.value),
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const spotlight = computed(() => config.value.archetypeId != null
		? freshness.data.value
		: null);
	const pilots = computed(() => spotlight.value?.pilots ?? []);
	const topCards = computed(() => spotlight.value?.topCards ?? []);

	const { pageData, rowCount, totalPages, currentPage } = usePaginatedScreenMode({ mode: 'archetype-spotlight', config, rows: pilots });

	// ── Header ──
	const scopeLabel = computed(() => {
		switch (config.value.scope) {
			case 'topN': return `Top ${config.value.topN}`;
			case 'minPoints': return `${config.value.minPoints}+ Points`;
			case 'playerList': return 'List';
			default: return null;
		}
	});

	const headerText = computed(() => {
		if (config.value.headerText)
			return config.value.headerText;
		const name = spotlight.value?.archetype.name;
		if (!name)
			return 'Archetype Spotlight';
		return scopeLabel.value
			? `${scopeLabel.value} Spotlight: ${name}`
			: `Spotlight: ${name}`;
	});

	/** The conversion target, named as the app's archetype page names it. */
	const conversionLabel = computed(() => config.value.conversionMetric === 'topN'
		? `Top ${config.value.conversionThreshold}`
		: `${config.value.conversionThreshold}+ pts`);

	function formatRecord(pilot: ScreenOutputArchetypePilot): string {
		return formatPlayerRecord(pilot, eventStore.displayEvent);
	}

	// Nothing to show until an Archetype is picked and has pilots in the scope.
	const isEmpty = computed(() => freshness.answered.value && (config.value.archetypeId == null || (spotlight.value != null && pilots.value.length === 0)));

	return {
		config,
		loading,
		error,
		isEmpty,
		headerText,
		conversionLabel,
		spotlight,
		topCards,
		pageData,
		rowCount,
		currentPage,
		totalPages,
		formatRecord,
	};
}
