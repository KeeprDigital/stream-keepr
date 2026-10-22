import type { BracketEntrant, BracketRoundInput } from '~~/shared/modules/top-cut-bracket';
import type { ScreenOutputMatchSide, ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { mapPhaseToResponse } from '~~/server/mappers/phase';
import { phaseService } from '~~/server/services/phase';
import { roundService } from '~~/server/services/round';
import { findMatchesByRound } from '~~/server/services/roundMatches';
import { deriveTopCutBracket, EMPTY_TOP_CUT_BRACKET } from '~~/shared/modules/top-cut-bracket';

function entrant(side: ScreenOutputMatchSide | null): BracketEntrant | null {
	return side && { playerId: side.id, name: side.name };
}

/**
 * A Phase's Top Cut Bracket: its Rounds in order and their Matches, derived
 * into one column per Round (#752). The Top Cut Bracket Screen Output's read. Naming
 * no Phase, or one the Event does not hold, answers no Phase and an empty
 * bracket. Each side is named as Pairings names it: its Player by their
 * current name, or the Match's own record of a side no Player holds.
 */
export async function findPhaseBracket(eventId: number, phaseId: number | undefined): Promise<ScreenOutputTopCutResponse> {
	const phase = phaseId ? await phaseService().findById(phaseId, eventId) : undefined;
	if (!phase)
		return { phase: null, bracket: EMPTY_TOP_CUT_BRACKET };

	const rounds = await roundService().findByPhaseId(phase.id, eventId);
	const matchesByRound = await findMatchesByRound(eventId, rounds.map(round => round.id));

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
