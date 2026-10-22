import type { FeatureMatchResponse, MatchResponse, PhaseResponse, PlayerResponse, RoundResponse } from '~~/shared/api';
import type { ArchetypeBreakdownResponse, CardBreakdownResponse, PlayerDeckCollectionResponse } from '~~/shared/types/metagame';

/**
 * The answers of the Screen Output read family (#604, ADR-0022): what one
 * Screen publishes for its outputs to render, each derived on the server from
 * the Screen's saved configuration.
 */

/** A Metagame Screen's breakdown, in the view its configuration selects. */
export type ScreenOutputMetagameResponse
	= | { viewMode: 'archetype'; breakdown: ArchetypeBreakdownResponse }
		| { viewMode: 'cards'; breakdown: CardBreakdownResponse };

/** One Player's record as it stood at the end of a Round. */
export interface ScreenOutputRoundStanding {
	playerId: number;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	position: number | null;
	points: number | null;
}

/** What a Standings Screen renders from. */
export interface ScreenOutputStandingsResponse {
	/** The Event's active roster, as the operator's Players read answers it. */
	players: PlayerResponse[];
	/** The Round the configuration fixes the standings at, if any. */
	round: RoundResponse | null;
	/** The snapshot at that Round; `null` when the standings are current. */
	roundStandings: ScreenOutputRoundStanding[] | null;
	/** The watchlist's name and members; `null` unless the view is a watchlist of a list that exists. */
	watchlist: { name: string; playerIds: number[] } | null;
}

/** One side of a Match as Pairings names it: its Player, or the Match's own record of a side no Player holds. */
export interface ScreenOutputPairingSide {
	id: number | null;
	name: string;
}

/** One Match of a Round, as Pairings lists it. */
export interface ScreenOutputPairing {
	matchId: number;
	tableNumber: number | null;
	/** `null` for a side no Player and no name fills, such as a bye's second seat. */
	player1: ScreenOutputPairingSide | null;
	player2: ScreenOutputPairingSide | null;
	isBye: boolean;
	hasResult: boolean;
	player1GameWins: number | null;
	player2GameWins: number | null;
	gameDraws: number | null;
	resultString: string | null;
}

/** What a Pairings Screen renders from: its Round, and that Round's Matches in table order. */
export interface ScreenOutputPairingsResponse {
	round: RoundResponse;
	pairings: ScreenOutputPairing[];
}

/** A Feature Match Slot the Screen's mode shows, with the Match it is following. */
export interface ScreenOutputFeatureMatchResponse {
	slot: FeatureMatchResponse;
	match: MatchResponse | null;
	round: RoundResponse | null;
	phase: PhaseResponse | null;
}

/** A Player the Screen renders, with their decks as the operator's decks read answers them. */
export interface ScreenOutputPlayerDecksResponse {
	player: PlayerResponse;
	decks: PlayerDeckCollectionResponse;
}
