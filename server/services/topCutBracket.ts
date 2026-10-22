import type { BracketEntrant, BracketRoundInput, NamedPlayerDeckIdentity } from '~~/shared/modules/top-cut-bracket';
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
import { resolvePlayerDeckIdentity } from '~~/shared/utils/gameData';

/** What a Top Cut Screen shows beside each Player's name (#759). */
export type TopCutEntrantDetails = Partial<Pick<TopCutModeConfig, 'showSeeds' | 'showArchetypes'>>;

/** Each Player's seed: their position in the Round Standings that seed the Phase. */
async function findSeeds(eventId: number, phaseId: number): Promise<Map<number, number | null>> {
	const standings = await playerRoundStandingsService().findSeedPositions(eventId, phaseId);
	return new Map(standings?.positions.map(({ playerId, position }) => [playerId, position]));
}

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
			row.archetypeName == null ? null : { name: row.archetypeName, colors: row.archetypeColors },
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
	for (const match of [...matchesByRound.values()].flat()) {
		for (const side of [match.player1, match.player2]) {
			if (side?.id != null)
				ids.add(side.id);
		}
	}
	return [...ids];
}

/**
 * A Phase's Top Cut Bracket: its Rounds in order and their Matches, derived
 * into one column per Round (#752). The Top Cut Screen Output's read. Naming
 * no Phase, or one the Event does not hold, answers no Phase and an empty
 * bracket. Each side is named as Pairings names it: its Player by their
 * current name, or the Match's own record of a side no Player holds.
 *
 * Each Player's seed and deck are read only when `details` asks for them
 * (#759), so a Screen that shows neither pays for neither.
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
	const [seeds, decks] = await Promise.all([
		details.showSeeds ? findSeeds(eventId, phase.id) : null,
		details.showArchetypes ? findDecks(eventId, seatedPlayerIds(matchesByRound)) : null,
	]);

	function entrant(side: ScreenOutputMatchSide | null): BracketEntrant | null {
		if (!side)
			return null;
		const seated: BracketEntrant = { playerId: side.id, name: side.name };
		const of = <T>(byPlayer: Map<number, T>) => side.id == null ? null : byPlayer.get(side.id) ?? null;
		if (seeds)
			seated.seed = of(seeds);
		if (decks)
			seated.deck = of(decks);
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
