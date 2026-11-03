import type { BracketEntrant, BracketRoundInput, NamedPlayerDeckIdentity, SeededPlayer } from '~~/shared/modules/top-cut-bracket';
import type { TopCutModeConfig } from '~~/shared/screenModeConfigs/topCut';
import type { ScreenOutputMatchSide, ScreenOutputRoundMatch, ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, players } from '~~/server/db/schema';
import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { phaseService } from '~~/server/services/phase';
import { playerRoundStandingsService } from '~~/server/services/playerRoundStandings';
import { roundService } from '~~/server/services/round';
import { findMatchesByRound } from '~~/server/services/roundMatches';
import { deriveTopCutBracket, EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';
import { TOP_CUT_BRACKET_SIZES } from '~~/shared/screenModeConfigs/topCut';
import { resolvePlayerDeckIdentity } from '~~/shared/utils/gameData';

/**
 * What a Top Cut Bracket Screen shows beside each Player's name (#759), and
 * the bracket size its operator sets (#906).
 */
export type TopCutBracketReadOptions = Partial<Pick<TopCutModeConfig, 'showSeeds' | 'showArchetypes' | 'bracketSizeOverride'>>;

/** The most Players a bracket the operator sizes seats, so the most Seeds that can take a bye. */
const MOST_SEEDS_ON_BYES = Math.max(...TOP_CUT_BRACKET_SIZES);

/** Each of these Players' deck as a broadcast names it, absent when nothing names one. */
async function findDecks(eventId: number, playerIds: readonly number[]): Promise<Map<number, NamedPlayerDeckIdentity>> {
	if (playerIds.length === 0)
		return new Map();
	const rows = await db
		.select({
			id: players.id,
			gameData: players.gameData,
			archetypeName: archetypes.name,
			archetypeColors: archetypes.colors,
		})
		.from(players)
		.leftJoin(archetypes, eq(players.archetypeId, archetypes.id))
		.where(and(eq(players.eventId, eventId), inArray(players.id, [...playerIds])));

	const byPlayer = new Map<number, NamedPlayerDeckIdentity>();
	for (const row of rows) {
		const { name, colors } = resolvePlayerDeckIdentity(
			row.archetypeName == null
				? null
				: { name: row.archetypeName, colors: row.archetypeColors },
			row.gameData,
		);
		if (name)
			byPlayer.set(row.id, { name, colors });
	}
	return byPlayer;
}

/** Every Player of the Event these Matches seat. */
function seatedPlayerIds(matchesByRound: ReadonlyMap<number, readonly ScreenOutputRoundMatch[]>): number[] {
	const ids = new Set<number>();
	for (const match of [
		...matchesByRound.values(),
	].flat()) {
		for (const side of [match.player1, match.player2]) {
			if (side?.id != null)
				ids.add(side.id);
		}
	}
	return [...ids];
}

/**
 * A Phase's Top Cut Bracket: its Rounds in order and their Matches, derived
 * into one column per Round (#752). The Top Cut Bracket Screen Output's read. Naming
 * no Phase, or one the Event does not hold, answers no Phase and an empty
 * bracket. Each side is named as Pairings names it: its Player by their
 * current name, or the Match's own record of a side no Player holds.
 *
 * Seeds are always read, since they place the first Round and name its byes
 * (#906); each Player's seed is shown, and their deck read, only when
 * `options` asks for them (#759).
 */
export async function findPhaseBracket(
	eventId: number,
	phaseId: number | undefined,
	options: TopCutBracketReadOptions = {},
): Promise<ScreenOutputTopCutResponse> {
	const phase = phaseId
		? await phaseService().findById(phaseId, eventId)
		: undefined;
	if (!phase)
		return { phase: null, bracket: EMPTY_TOP_CUT_BRACKET };

	const rounds = await roundService().findByPhaseId(phase.id, eventId);
	const matchesByRound = await findMatchesByRound(eventId, rounds.map(round => round.id));
	const seededPlayers = await playerRoundStandingsService().findSeededPlayers(eventId, phase.id);
	const seeds = new Map(seededPlayers.map(({ playerId, seed }) => [playerId, seed]));
	const decks = options.showArchetypes
		? await findDecks(eventId, [
				...new Set([
					...seatedPlayerIds(matchesByRound),
					...seededPlayers.filter(({ seed }) => seed <= MOST_SEEDS_ON_BYES).map(({ playerId }) => playerId),
				]),
			])
		: null;

	function entrant(side: ScreenOutputMatchSide): BracketEntrant {
		const shown: BracketEntrant = { playerId: side.id, name: side.name };
		const of = <T>(byPlayer: Map<number, T>) => side.id == null
			? null
			: byPlayer.get(side.id) ?? null;
		if (options.showSeeds)
			shown.seed = of(seeds);
		if (decks)
			shown.deck = of(decks);
		return shown;
	}
	const side = (seated: ScreenOutputMatchSide | null) => seated && entrant(seated);

	const bracketRounds: BracketRoundInput[] = rounds.map(round => ({
		roundId: round.id,
		name: round.name,
		matches: (matchesByRound.get(round.id) ?? []).map(match => ({
			matchId: match.matchId,
			tableNumber: match.tableNumber,
			player1: side(match.player1),
			player2: side(match.player2),
			isBye: match.isBye,
			hasResult: match.hasResult,
			player1GameWins: match.player1GameWins,
			player2GameWins: match.player2GameWins,
			gameDraws: match.gameDraws,
		})),
	}));

	return {
		phase: mapPhaseToResponse(phase),
		bracket: deriveTopCutBracket(bracketRounds, {
			size: options.bracketSizeOverride,
			seeds: seededPlayers.map(({ playerId, name, seed }): SeededPlayer => ({
				seed,
				entrant: entrant({ id: playerId, name }),
			})),
		}),
	};
}
