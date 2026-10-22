import type { BracketEntrant, BracketRoundInput } from '~~/shared/modules/top-cut-bracket';
import type { ScreenOutputMatchSide, ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '~~/server/db';
import { archetypes, players } from '~~/server/db/schema';
import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { phaseService } from '~~/server/services/phase';
import { playerRoundStandingsService } from '~~/server/services/playerRoundStandings';
import { roundService } from '~~/server/services/round';
import { findMatchesByRound } from '~~/server/services/roundMatches';
import { deriveTopCutBracket, EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';
import { resolvePlayerDeckIdentity } from '~~/shared/utils/gameData';

/** What a Top Cut Screen shows beside each Player's name (#759). */
export interface TopCutEntrantDetails {
	seeds?: boolean;
	archetypes?: boolean;
}

type EntrantArchetype = NonNullable<BracketEntrant['archetype']>;

/** Each Player's seed: their position in the Round Standings that seed the Phase. */
async function findSeeds(eventId: number, phaseId: number): Promise<Map<number, number | null>> {
	const standings = await playerRoundStandingsService().findSeedPositions(eventId, phaseId);
	return new Map(standings?.positions.map(({ playerId, position }) => [playerId, position]));
}

/** Each of these Players' Archetype as a broadcast names it, absent when they have none. */
async function findArchetypes(eventId: number, playerIds: readonly number[]): Promise<Map<number, EntrantArchetype>> {
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

	const byPlayer = new Map<number, EntrantArchetype>();
	for (const row of rows) {
		const { name, colors } = resolvePlayerDeckIdentity(
			row.archetypeName == null ? null : { name: row.archetypeName, colors: row.archetypeColors },
			row.gameData,
		);
		if (name)
			byPlayer.set(row.id, { name, colors });
	}
	return byPlayer;
}

/**
 * A Phase's Top Cut Bracket: its Rounds in order and their Matches, derived
 * into one column per Round (#752). The Top Cut Screen Output's read. Naming
 * no Phase, or one the Event does not hold, answers no Phase and an empty
 * bracket. Each side is named as Pairings names it: its Player by their
 * current name, or the Match's own record of a side no Player holds.
 *
 * Each Player's seed and Archetype are read only when `details` asks for
 * them (#759), so a Screen that shows neither pays for neither.
 */
export async function findPhaseBracket(
	eventId: number,
	phaseId: number | undefined,
	details: TopCutEntrantDetails = {},
): Promise<ScreenOutputTopCutResponse> {
	const phase = phaseId ? await phaseService().findById(phaseId, eventId) : undefined;
	if (!phase)
		return { phase: null, bracket: EMPTY_TOP_CUT_BRACKET };

	const rounds = await roundService().findByPhaseId(phase.id, eventId);
	const matchesByRound = await findMatchesByRound(eventId, rounds.map(round => round.id));
	const playerIds = [...new Set([...matchesByRound.values()].flat().flatMap(match => [match.player1?.id, match.player2?.id]).filter(id => id != null))];
	const [seeds, archetypesByPlayer] = await Promise.all([
		details.seeds ? findSeeds(eventId, phase.id) : null,
		details.archetypes ? findArchetypes(eventId, playerIds) : null,
	]);

	function entrant(side: ScreenOutputMatchSide | null): BracketEntrant | null {
		if (!side)
			return null;
		const seated: BracketEntrant = { playerId: side.id, name: side.name };
		if (seeds)
			seated.seed = side.id == null ? null : seeds.get(side.id) ?? null;
		if (archetypesByPlayer)
			seated.archetype = side.id == null ? null : archetypesByPlayer.get(side.id) ?? null;
		return seated;
	}

	const bracketRounds: BracketRoundInput[] = rounds.map(round => ({
		roundId: round.id,
		name: round.name,
		matches: (matchesByRound.get(round.id) ?? []).map(match => ({
			matchId: match.matchId,
			tableNumber: match.tableNumber,
			player1: entrant(match.player1),
			player2: entrant(match.player2),
			isBye: match.isBye,
			hasResult: match.hasResult,
			player1GameWins: match.player1GameWins,
			player2GameWins: match.player2GameWins,
			gameDraws: match.gameDraws,
		})),
	}));

	return { phase: mapPhaseToResponse(phase), bracket: deriveTopCutBracket(bracketRounds) };
}
