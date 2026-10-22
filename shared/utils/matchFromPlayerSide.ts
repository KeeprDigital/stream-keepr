import type { PlayerGameData } from '../types/game';
import { getMtgGameData } from './gameData';

/** How a Match ended for one of its Players. */
export type MatchSideOutcome = 'win' | 'loss' | 'draw' | 'bye' | 'pending';

/** What a Match holds of its result, as stored with player 1 and player 2 sides. */
export interface MatchResultFacts {
	player1Id: number | null;
	player1GameWins: number | null;
	player2GameWins: number | null;
	gameDraws: number | null;
	isBye: boolean;
	hasResult: boolean;
}

/** A Match's result read from one Player's side: their game wins first. */
export interface MatchSide {
	outcome: MatchSideOutcome;
	playerGameWins: number | null;
	opponentGameWins: number | null;
	gameDraws: number | null;
	hasResult: boolean;
}

/**
 * A Match's result from `playerId`'s side. A bye is a bye whatever its game
 * wins; a Match without a reported result, or with one but no game wins, is
 * pending.
 */
export function readMatchFromPlayerSide(match: MatchResultFacts, playerId: number): MatchSide {
	const isPlayer1 = match.player1Id === playerId;
	const playerGameWins = isPlayer1 ? match.player1GameWins : match.player2GameWins;
	const opponentGameWins = isPlayer1 ? match.player2GameWins : match.player1GameWins;

	let outcome: MatchSideOutcome = 'pending';
	if (match.isBye)
		outcome = 'bye';
	else if (match.hasResult && playerGameWins != null && opponentGameWins != null)
		outcome = playerGameWins > opponentGameWins ? 'win' : playerGameWins < opponentGameWins ? 'loss' : 'draw';

	return { outcome, playerGameWins, opponentGameWins, gameDraws: match.gameDraws, hasResult: match.hasResult };
}

/**
 * A Match's game score from one Player's side, theirs first: `2-1`, or
 * `1-1-1` with game draws. `null` for a bye or a Match with no game wins
 * reported, which have no score to show.
 */
export function formatGameScore(side: MatchSide): string | null {
	if (side.outcome === 'bye' || !side.hasResult || side.playerGameWins == null || side.opponentGameWins == null)
		return null;
	return `${side.playerGameWins}-${side.opponentGameWins}${side.gameDraws ? `-${side.gameDraws}` : ''}`;
}

/** A Player's deck identity as a broadcast names it. */
export interface PlayerArchetype {
	name: string | null;
	colors: string | null;
}

/**
 * The name and colours a broadcast shows for a Player's deck: their assigned
 * Archetype, else the name their primary Deck List projects into game data.
 * Blank when the Player has neither, as when they have no Deck List.
 */
export function resolvePlayerArchetype(
	archetype: { name: string; colors: string | null } | null,
	gameData: PlayerGameData | null | undefined,
): PlayerArchetype {
	const mtg = getMtgGameData(gameData);
	return {
		name: archetype?.name ?? mtg.deckName ?? null,
		colors: archetype?.colors ?? mtg.deckColors ?? null,
	};
}
