import type { TopCutBracketSource } from '~~/shared/screenModeConfigs/topCut';
import type { MessageType } from '~~/shared/types/messages';
import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import type { ScreenContext } from '~/composables/screen/useScreenContext';
import type { ScreenModeDependencies } from '~/modules/screen-mode/freshness';
import { EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';
import { topCutBracketSource } from '~~/shared/screenModeConfigs/topCut';
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
export function topCutDependencies(
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
 * The Event Data a Manual Bracket is read from (ADR-0075): the Players its
 * Seeds name, and while Archetypes show, the Archetypes and Deck Lists naming
 * them. Its Seeds and results are the Screen's own config, so an edit to them
 * re-reads through the read's source.
 */
export function manualBracketDependencies(showsArchetypes: () => boolean): ScreenModeDependencies<ScreenOutputTopCutResponse> {
	return {
		'player:updated': ({ player }, held) => holdsPlayer(held, player.id),
		'player:deleted': ({ playerId }, held) => holdsPlayer(held, playerId),
		'archetype:updated': showsArchetypes,
		'archetype:deleted': showsArchetypes,
		'tcgplus:imported': true,
		'melee:decklistsSynced': showsArchetypes,
		'melee:dataReset': true,
		'melee:playersSynced': true,
	};
}

/** One dependency map answering as the source the bracket reads now does, since an operator may switch it live. */
function followingSource(
	source: () => TopCutBracketSource,
	bySource: Record<TopCutBracketSource, ScreenModeDependencies<ScreenOutputTopCutResponse>>,
): ScreenModeDependencies<ScreenOutputTopCutResponse> {
	const types = new Set([
		...Object.keys(bySource.phase),
		...Object.keys(bySource.manual),
	]) as Set<MessageType>;
	return Object.fromEntries([...types].map(type => [
		type,
		(message: unknown, held: ScreenOutputTopCutResponse) => {
			const dependency = bySource[source()][type] as true | ((message: unknown, held: ScreenOutputTopCutResponse) => boolean) | undefined;
			return dependency === true || (dependency?.(message, held) ?? false);
		},
	]));
}

/**
 * What a Top Cut Bracket Screen renders: the bracket of the Phase its configuration
 * names, or its Manual Bracket (ADR-0075), read through the Screen and kept
 * current by Screen Mode Data Freshness.
 */
export function useTopCutModeData(context: ScreenContext) {
	const { eventId } = context;
	const config = useScreenModeConfig(context, 'top-cut');
	const game = useScreenCardGame(context);
	const outputReads = useScreenOutputReads(context);
	const source = computed(() => topCutBracketSource(game.value, config.value));

	// The server reads the source itself; this only says when what it reads may have changed.
	const readKey = () => {
		const scope = outputReads.scopeKey.value;
		if (!scope)
			return null;
		const shown = `${config.value.showSeeds}:${config.value.showArchetypes}:${config.value.playerNameShown}`;
		if (source.value === 'manual')
			return `${scope}:manual:${JSON.stringify(config.value.manualBracket)}:${shown}`;
		return config.value.phaseId
			? `${scope}:${config.value.phaseId}:${config.value.bracketSizeOverride ?? 'auto'}:${shown}`
			: null;
	};
	const dependsOn = followingSource(() => source.value, {
		phase: topCutDependencies(() => config.value.phaseId, () => config.value.showArchetypes),
		manual: manualBracketDependencies(() => config.value.showArchetypes),
	});

	const freshness = useScreenModeFreshness<ScreenOutputTopCutResponse>({
		eventId,
		source: readKey,
		read: () => outputReads.topCut(),
		initialData: NO_BRACKET,
		errorMessage: 'Failed to load the bracket',
		dependsOn,
	});
	const loading = freshness.loading;
	const error = freshness.error;
	const phase = computed(() => freshness.data.value.phase);
	const bracket = computed(() => freshness.data.value.bracket);

	const headerText = computed(() => config.value.headerText || phase.value?.name || 'Top Cut');
	const isEmpty = computed(() => freshness.answered.value && (
		(source.value === 'phase' && !config.value.phaseId)
		|| bracket.value.columns.length === 0));

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
