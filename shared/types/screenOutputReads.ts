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
	/**
	 * The previous Round's Round Standings positions, which the Position Change
	 * column measures against (#755); `null` unless that column shows, and when
	 * there is no previous Round.
	 */
	previousRoundPositions: ScreenOutputPreviousRoundPositions | null;
}

/** Each Player's position in the Round Standings of the Round before the one shown. */
export interface ScreenOutputPreviousRoundPositions {
	roundId: number;
	positions: Array<{ playerId: number; position: number | null }>;
}

/** One side of a Match as Pairings names it: its Player, or the Match's own record of a side no Player holds. */
export interface ScreenOutputMatchSide {
	/** The seated Player; `null` when the side names no Player of the Event. */
	id: number | null;
	name: string;
}

/** One Match of a Round, as Pairings lists it. */
export interface ScreenOutputRoundMatch {
	matchId: number;
	tableNumber: number | null;
	/** `null` for a side no Player and no name fills, such as a bye's second seat. */
	player1: ScreenOutputMatchSide | null;
	player2: ScreenOutputMatchSide | null;
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
	matches: ScreenOutputRoundMatch[];
}

/** One side of a Head-to-head: the Player, their current record and points, and their deck as a broadcast names it. */
export interface ScreenOutputHeadToHeadPlayer {
	id: number;
	name: string;
	pronouns: string | null;
	wins: number | null;
	losses: number | null;
	draws: number | null;
	points: number | null;
	/** Their Archetype's name, else the deck name their Deck List projects; `null` with neither. */
	deckName: string | null;
	deckColors: string | null;
}

/** An earlier reported Match between a Head-to-head's two Players at this Event. */
export interface ScreenOutputHeadToHeadEarlierMatch {
	matchId: number;
	roundId: number;
	roundName: string;
	roundNumber: number;
	phaseName: string;
	/**
	 * How it ended: won by the first or second Player, drawn, or reported with
	 * only a result string, which names no winner a broadcast can show.
	 */
	outcome: HeadToHeadOutcome;
	/** Its Game Score from the first Player's side; `null` when only a result string was reported. */
	gameScore: string | null;
	resultString: string | null;
}

/** How an earlier Match between a Head-to-head's two Players ended, from the first Player's side. */
export type HeadToHeadOutcome = 'player1' | 'player2' | 'draw' | 'reported';

/** What a Head-to-head Screen renders from: its two Players, and their earlier Matches oldest first. */
export interface ScreenOutputHeadToHeadResponse {
	/** `null` for a side no Player fills, such as an empty Slot's. */
	player1: ScreenOutputHeadToHeadPlayer | null;
	player2: ScreenOutputHeadToHeadPlayer | null;
	earlierMatches: ScreenOutputHeadToHeadEarlierMatch[];
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
