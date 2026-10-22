import type { PlayerSlotData } from '~~/shared/api';
import type { BracketEntrant, BracketRoundInput } from '~~/shared/modules/top-cut-bracket';
import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { db } from '~~/server/db';
import { matches, players } from '~~/server/db/schema';
import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { phaseService } from '~~/server/services/phase';
import { roundService } from '~~/server/services/round';
import { deriveTopCutBracket, EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';

const player1 = alias(players, 'bracket_player1');
const player2 = alias(players, 'bracket_player2');

/**
 * One side of a Match: its Player by their current name, so a rename shows at
 * once, or else the Match's own record of the side, which names no Player.
 * `null` for a side neither fills, such as a bye's empty seat.
 */
function entrant(joinedName: string | null, playerId: number | null, slot: PlayerSlotData | null): BracketEntrant | null {
	if (joinedName != null && playerId != null)
		return { playerId, name: joinedName };
	return slot?.name ? { playerId: null, name: slot.name } : null;
}

/**
 * A Phase's Top Cut Bracket: its Rounds in order and their Matches, derived
 * into one column per Round (#752). The Top Cut Screen Output's read. Naming
 * no Phase, or one the Event does not hold, answers no Phase and an empty
 * bracket.
 */
export async function findPhaseBracket(eventId: number, phaseId: number | undefined): Promise<ScreenOutputTopCutResponse> {
	const phase = phaseId ? await phaseService().findById(phaseId, eventId) : undefined;
	if (!phase)
		return { phase: null, bracket: EMPTY_TOP_CUT_BRACKET };

	const rounds = await roundService().findByPhaseId(phase.id, eventId);
	const rows = rounds.length === 0
		? []
		: await db
				.select({ match: matches, player1Name: player1.name, player2Name: player2.name })
				.from(matches)
				.leftJoin(player1, and(eq(player1.id, matches.player1Id), eq(player1.eventId, eventId)))
				.leftJoin(player2, and(eq(player2.id, matches.player2Id), eq(player2.eventId, eventId)))
				.where(and(eq(matches.eventId, eventId), inArray(matches.roundId, rounds.map(round => round.id))))
				.orderBy(asc(matches.sortOrder), asc(matches.id));

	const bracketRounds: BracketRoundInput[] = rounds.map(round => ({
		roundId: round.id,
		name: round.name,
		matches: rows
			.filter(({ match }) => match.roundId === round.id)
			.map(({ match, player1Name, player2Name }) => ({
				matchId: match.id,
				tableNumber: match.tableNumber,
				player1: entrant(player1Name, match.player1Id, match.player1Data),
				player2: entrant(player2Name, match.player2Id, match.player2Data),
				isBye: match.isBye,
				hasResult: match.hasResult,
				player1GameWins: match.player1GameWins,
				player2GameWins: match.player2GameWins,
				gameDraws: match.gameDraws,
			})),
	}));

	return { phase: mapPhaseToResponse(phase), bracket: deriveTopCutBracket(bracketRounds) };
}
