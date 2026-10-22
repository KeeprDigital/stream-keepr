import type { PlayerSlotData } from '~~/shared/api';
import type { ScreenOutputMatchSide, ScreenOutputPairingsResponse, ScreenOutputRoundMatch } from '~~/shared/types/screenOutputReads';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '~~/server/db';
import { matches, players } from '~~/server/db/schema';
import { mapRoundToResponse } from '~~/server/mappers/round';
import { roundService } from '~~/server/services/round';

const player1 = alias(players, 'match_player1');
const player2 = alias(players, 'match_player2');

/**
 * One side of a Match: its Player by their current name, so a rename shows at
 * once, or else the Match's own record of the side, which names no Player.
 * `null` for a side neither fills, such as a bye's empty seat.
 *
 * `joinedName` is the seated Player's name, absent when no Player of the Event
 * is seated there.
 */
function matchSide(joinedName: string | null, playerId: number | null, slot: PlayerSlotData | null): ScreenOutputMatchSide | null {
	if (joinedName != null && playerId != null)
		return { id: playerId, name: joinedName };
	return slot?.name ? { id: null, name: slot.name } : null;
}

/**
 * The Matches of each of these Rounds of the Event, each Round's in table
 * order, its byes and other untabled Matches last. A Round holding none is
 * absent. Shared by the Pairings (#751) and Top Cut Bracket (#752) Screen Output reads,
 * so both name a Match's sides alike.
 */
export async function findMatchesByRound(eventId: number, roundIds: readonly number[]): Promise<Map<number, ScreenOutputRoundMatch[]>> {
	const byRound = new Map<number, ScreenOutputRoundMatch[]>();
	if (roundIds.length === 0)
		return byRound;

	const rows = await db
		.select({
			match: matches,
			player1Name: player1.name,
			player2Name: player2.name,
		})
		.from(matches)
		.leftJoin(player1, and(eq(player1.id, matches.player1Id), eq(player1.eventId, eventId)))
		.leftJoin(player2, and(eq(player2.id, matches.player2Id), eq(player2.eventId, eventId)))
		.where(and(eq(matches.eventId, eventId), inArray(matches.roundId, [...roundIds])))
		.orderBy(sql`${matches.tableNumber} is null`, asc(matches.tableNumber), asc(matches.sortOrder), asc(matches.id));

	for (const { match, player1Name, player2Name } of rows) {
		const roundMatches = byRound.get(match.roundId) ?? [];
		roundMatches.push({
			matchId: match.id,
			tableNumber: match.tableNumber,
			player1: matchSide(player1Name, match.player1Id, match.player1Data),
			player2: matchSide(player2Name, match.player2Id, match.player2Data),
			isBye: match.isBye,
			hasResult: match.hasResult,
			player1GameWins: match.player1GameWins,
			player2GameWins: match.player2GameWins,
			gameDraws: match.gameDraws,
			resultString: match.resultString,
		});
		byRound.set(match.roundId, roundMatches);
	}
	return byRound;
}

/**
 * One Round's Matches in table order, the Round's byes and other untabled
 * Matches last. `null` when the Event has no such Round.
 *
 * The Pairings Screen Output's read (#751).
 */
export async function findRoundMatches(eventId: number, roundId: number): Promise<ScreenOutputPairingsResponse | null> {
	const round = await roundService().findById(roundId, eventId);
	if (!round)
		return null;

	const byRound = await findMatchesByRound(eventId, [roundId]);
	return { round: mapRoundToResponse(round), matches: byRound.get(roundId) ?? [] };
}
