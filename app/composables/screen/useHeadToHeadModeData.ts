import type { HeadToHeadModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenOutputHeadToHeadPlayer, ScreenOutputHeadToHeadResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';
import { useScreenModeHearing } from '~/modules/screen-mode/hearing';

type HeldHeadToHead = ScreenOutputHeadToHeadResponse | null;

/** What the configuration selects, as one comparable value; `null` while it selects nothing. */
function selection(config: HeadToHeadModeConfig): string | null {
	if (config.playerSource === 'players') {
		return config.player1Id || config.player2Id
			? `players:${config.player1Id ?? ''}:${config.player2Id ?? ''}`
			: null;
	}
	return config.featureMatchId
		? `slot:${config.featureMatchId}`
		: null;
}

/**
 * A Head-to-Head's two Players and their earlier Matches, kept current on a
 * Screen Output (#760). Bound to a Feature Match Slot, it follows the Slot's
 * current Feature Match Assignment as the Slot is reassigned.
 */
export function useHeadToHeadModeData(context: ScreenContext) {
	const config = useScreenModeConfig(context, 'head-to-head');
	const outputReads = useScreenOutputReads(context);
	const eventStore = useEventStore();

	const freshness = useScreenModeFreshness<HeldHeadToHead>({
		hearing: useScreenModeHearing(context, 'head-to-head', () => config.value),
		source: () => {
			const selected = selection(config.value);
			return outputReads.scopeKey.value && selected
				? `${outputReads.scopeKey.value}:${selected}`
				: null;
		},
		read: () => outputReads.headToHead(),
		initialData: null,
		errorMessage: 'Failed to load head-to-head',
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const player1 = computed(() => freshness.data.value?.player1 ?? null);
	const player2 = computed(() => freshness.data.value?.player2 ?? null);
	const earlierMatches = computed(() => freshness.data.value?.earlierMatches ?? []);

	const headerText = computed(() => config.value.headerText || 'Head to Head');
	/** Neither side holds a Player: nothing is selected, or the Slot seats no one. */
	const isEmpty = computed(() => freshness.answered.value && !player1.value && !player2.value);
	/** Both Players are known and have not met at this Event before. */
	const firstMeeting = computed(() => !!player1.value && !!player2.value && earlierMatches.value.length === 0);

	/**
	 * A record as the Event displays records, as Standings writes them; `null`
	 * for a Player with none yet.
	 */
	function formatRecord(record: Pick<ScreenOutputHeadToHeadPlayer, 'wins' | 'losses' | 'draws'>): string | null {
		if (record.wins == null && record.losses == null && record.draws == null)
			return null;
		return formatPlayerRecord(record, eventStore.displayEvent);
	}

	return {
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		loading,
		error,
		isEmpty,
		firstMeeting,
		headerText,
		player1,
		player2,
		earlierMatches,
		formatRecord,
	};
}
