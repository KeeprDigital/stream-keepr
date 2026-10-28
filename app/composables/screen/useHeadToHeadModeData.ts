import type { HeadToHeadModeConfig } from '~~/shared/types/screenConfig';
import type { ScreenOutputHeadToHeadPlayer, ScreenOutputHeadToHeadResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

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
 * The Event Data a Head-to-Head is read from: its Feature Match Slot, which
 * Players the Slot seats, those Players and their Archetypes, the Matches
 * between them, and the Round Standings their records come from. Melee's
 * wholesale syncs re-read.
 */
function headToHeadDependencies(boundSlotId: () => number | null): ScreenModeDependencies<HeldHeadToHead> {
	const isBoundSlot = (slotId: number) => slotId === boundSlotId();
	const heldPlayerIds = (held: HeldHeadToHead) => [held?.player1?.id, held?.player2?.id].filter((id): id is number => id != null);
	const holdsPlayer = (held: HeldHeadToHead, playerId: number) => heldPlayerIds(held).includes(playerId);
	const seatsBoth = (held: HeldHeadToHead, match: { player1Id: number | null; player2Id: number | null }) => {
		const ids = heldPlayerIds(held);
		return ids.length === 2 && match.player1Id != null && match.player2Id != null
			&& ids.includes(match.player1Id) && ids.includes(match.player2Id);
	};
	const holdsEarlierMatch = (held: HeldHeadToHead, matchId: number) => held?.earlierMatches.some(earlierMatch => earlierMatch.matchId === matchId) ?? false;

	return {
		'featureMatch:updated': ({ featureMatch }) => isBoundSlot(featureMatch.id),
		'featureMatch:deleted': ({ featureMatchId }) => isBoundSlot(featureMatchId),
		'melee:featureMatchesSynced': ({ slotIds }) => slotIds.some(isBoundSlot),
		'player:updated': ({ player }, held) => holdsPlayer(held, player.id),
		'player:deleted': ({ playerId }, held) => holdsPlayer(held, playerId),
		'match:created': ({ match }, held) => seatsBoth(held, match),
		'match:updated': ({ match }, held) => seatsBoth(held, match) || holdsEarlierMatch(held, match.id),
		'match:deleted': ({ matchId }, held) => holdsEarlierMatch(held, matchId),
		'round:updated': ({ round }, held) => held?.earlierMatches.some(earlierMatch => earlierMatch.roundId === round.id) ?? false,
		'round:deleted': true,
		'round:matchesRefreshed': true,
		'phase:updated': true,
		'phase:deleted': true,
		'archetype:updated': true,
		'archetype:deleted': true,
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:matchResultsSynced': true,
		'melee:pairingsSynced': true,
		'melee:roundStandingsSynced': true,
		'melee:playersSynced': true,
		'melee:decklistsSynced': true,
	};
}

/**
 * A Head-to-Head's two Players and their earlier Matches, kept current on a
 * Screen Output (#760). Bound to a Feature Match Slot, it follows the Slot's
 * current Feature Match Assignment as the Slot is reassigned.
 */
export function useHeadToHeadModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('head-to-head');
	const outputReads = useScreenOutputReads();
	const eventStore = useEventStore();

	const freshness = useScreenModeFreshness<HeldHeadToHead>({
		eventId,
		source: () => {
			const selected = selection(config.value);
			return outputReads.scopeKey.value && selected
				? `${outputReads.scopeKey.value}:${selected}`
				: null;
		},
		read: () => outputReads.headToHead(),
		initialData: null,
		errorMessage: 'Failed to load head-to-head',
		dependsOn: headToHeadDependencies(() => config.value.playerSource === 'featureMatchSlot'
			? config.value.featureMatchId ?? null
			: null),
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
