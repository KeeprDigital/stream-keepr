import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import { EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';
import { useScreenModeFreshness } from '~/modules/screen-mode/freshness';

const NO_BRACKET: ScreenOutputTopCutResponse = { phase: null, bracket: EMPTY_TOP_CUT_BRACKET };

function holdsRound(held: ScreenOutputTopCutResponse, roundId: number): boolean {
	return held.bracket.columns.some(column => column.roundId === roundId);
}

function holdsMatch(held: ScreenOutputTopCutResponse, matchId: number): boolean {
	return held.bracket.columns.some(column => column.positions.some(position => position.matchId === matchId));
}

function holdsPlayer(held: ScreenOutputTopCutResponse, playerId: number): boolean {
	return held.bracket.columns.some(column => column.positions.some(position =>
		position.entrants.some(entrant => entrant?.playerId === playerId)));
}

/**
 * The Event Data a Top Cut bracket is read from: its Phase, that Phase's
 * Rounds, their Matches, and the Players they seat. A reported result is a
 * `match:updated`, so it re-reads the bracket (#752). Melee's wholesale syncs
 * of structure and Players re-read; a Round's synced Match Results or pairings
 * re-read only for a Round the bracket shows.
 *
 * Seeds place the bracket whether or not they show (#906), so it reads the
 * Round Standings before the Phase too (#759): a sync of any Round may store
 * them, and any Round or Phase edit may reorder the Event's Rounds, so each
 * one re-reads. While Archetypes show, so do the Archetypes and Deck Lists
 * naming them. A Player's assigned Archetype is a `player:updated`, which
 * already re-reads.
 */
function topCutDependencies(
	phaseId: () => number | undefined,
	showsArchetypes: () => boolean,
): ScreenModeDependencies<ScreenOutputTopCutResponse> {
	const isPhase = (id: number) => id === phaseId();

	return {
		'phase:updated': true,
		'phase:deleted': true,
		'round:created': ({ round }) => isPhase(round.phaseId),
		'round:updated': true,
		'round:deleted': true,
		'round:matchesRefreshed': ({ roundId }, held) => holdsRound(held, roundId),
		'match:created': ({ match }, held) => holdsRound(held, match.roundId),
		'match:updated': ({ match }, held) => holdsRound(held, match.roundId) || holdsMatch(held, match.id),
		'match:deleted': ({ matchId }, held) => holdsMatch(held, matchId),
		'player:updated': ({ player }, held) => holdsPlayer(held, player.id),
		'player:deleted': ({ playerId }, held) => holdsPlayer(held, playerId),
		'archetype:updated': showsArchetypes,
		'archetype:deleted': showsArchetypes,
		'melee:matchResultsSynced': ({ roundId }, held) => holdsRound(held, roundId),
		'melee:pairingsSynced': ({ roundId }, held) => holdsRound(held, roundId),
		'melee:roundStandingsSynced': true,
		'melee:decklistsSynced': showsArchetypes,
		'melee:dataReset': true,
		'melee:structureSynced': true,
		'melee:playersSynced': true,
	};
}

/**
 * What a Top Cut Bracket Screen renders: the bracket of the Phase its configuration
 * names, read through the Screen and kept current by Screen Mode Data
 * Freshness.
 */
export function useTopCutModeData() {
	const { eventId } = useScreenContext();
	const config = useScreenModeConfig('top-cut');
	const outputReads = useScreenOutputReads();

	const freshness = useScreenModeFreshness<ScreenOutputTopCutResponse>({
		eventId,
		source: () => outputReads.scopeKey.value && config.value.phaseId
			? `${outputReads.scopeKey.value}:${config.value.phaseId}:${config.value.bracketSizeOverride ?? 'auto'}:${config.value.showSeeds}:${config.value.showArchetypes}`
			: null,
		read: () => outputReads.topCut(),
		initialData: NO_BRACKET,
		errorMessage: 'Failed to load the bracket',
		dependsOn: topCutDependencies(() => config.value.phaseId, () => config.value.showArchetypes),
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const phase = computed(() => freshness.data.value.phase);
	const bracket = computed(() => freshness.data.value.bracket);

	const headerText = computed(() => config.value.headerText || phase.value?.name || 'Top Cut');
	const isEmpty = computed(() => freshness.answered.value && (!config.value.phaseId || bracket.value.columns.length === 0));

	return {
		/** Rendering Readiness: its first read has answered or failed. */
		ready: freshness.answered,
		config,
		loading,
		error,
		isEmpty,
		headerText,
		phase,
		bracket,
	};
}
