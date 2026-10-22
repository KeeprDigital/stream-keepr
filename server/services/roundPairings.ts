import type { PlayerSlotData } from '~~/shared/api';
import type { ScreenOutputPairing, ScreenOutputPairingSide, ScreenOutputPairingsResponse } from '~~/shared/types/screenOutputReads';
import { and, asc, eq, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '~~/server/db';
import { matches, players } from '~~/server/db/schema';
import { mapRoundToResponse } from '~~/server/mappers/round';
import { roundService } from '~~/server/services/round';

const player1 = alias(players, 'pairing_player1');
const player2 = alias(players, 'pairing_player2');

/**
 * A side named by its Player's current name, so a rename shows at once, or by
 * the Match's own record of a side no Player holds.
 */
function pairingSide(playerId: number | null, playerName: string | null, slot: PlayerSlotData | null): ScreenOutputPairingSide | null {
	const name = playerName ?? slot?.name ?? null;
	if (playerId == null && !name)
		return null;
	return { id: playerName != null ? playerId : null, name: name ?? 'TBD' };
}

/**
 * One Round's Matches in table order, the Round's byes and other untabled
 * Matches last. `null` when the Event has no such Round.
 *
 * The Pairings Screen Output's read (#751).
 */
export async function findRoundPairings(eventId: number, roundId: number): Promise<ScreenOutputPairingsResponse | null> {
	const round = await roundService().findById(roundId, eventId);
	if (!round)
		return null;

	const rows = await db
		.select({
			match: matches,
			player1Name: player1.name,
			player2Name: player2.name,
		})
		.from(matches)
		.leftJoin(player1, and(eq(player1.id, matches.player1Id), eq(player1.eventId, eventId)))
		.leftJoin(player2, and(eq(player2.id, matches.player2Id), eq(player2.eventId, eventId)))
		.where(and(eq(matches.eventId, eventId), eq(matches.roundId, roundId)))
		.orderBy(sql`${matches.tableNumber} is null`, asc(matches.tableNumber), asc(matches.sortOrder), asc(matches.id));

	const pairings = rows.map(({ match, player1Name, player2Name }): ScreenOutputPairing => ({
		matchId: match.id,
		tableNumber: match.tableNumber,
		player1: pairingSide(match.player1Id, player1Name, match.player1Data),
		player2: pairingSide(match.player2Id, player2Name, match.player2Data),
		isBye: match.isBye,
		hasResult: match.hasResult,
		player1GameWins: match.player1GameWins,
		player2GameWins: match.player2GameWins,
		gameDraws: match.gameDraws,
		resultString: match.resultString,
	}));

	return { round: mapRoundToResponse(round), pairings };
}
