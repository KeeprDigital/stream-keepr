import type { FeatureMatchResponse, MatchResponse, PhaseResponse, PlayerResponse, RoundResponse } from '~~/shared/api';
import type { ArchetypeBreakdownResponse, CardBreakdownEntry, CardBreakdownResponse, PlayerDeckCollectionResponse } from '~~/shared/types/metagame';

/**
 * The answers of the Screen Output read family (#604, ADR-0022): what one
 * Screen publishes for its outputs to render, each derived on the server from
 * the Screen's saved configuration.
 */

/** A Metagame Screen's breakdown, in the view its configuration selects. */
export type ScreenOutputMetagameResponse
	= | { viewMode: 'archetype'; breakdown: ArchetypeBreakdownResponse }
		| { viewMode: 'cards'; breakdown: CardBreakdownResponse };

/** One pilot of the spotlit Archetype: a Player in the scope, with their standing. */
export interface ScreenOutputArchetypePilot {
	id: number;
	name: string;
	/** `null` while the Player has no placement. */
	position: number | null;
	points: number | null;
	wins: number | null;
	losses: number | null;
	draws: number | null;
}

/**
 * What an Archetype Spotlight Screen renders from (#761): one Archetype within
 * a Metagame scope, its numbers as the app's archetype detail page reads them
 * for the same scope and conversion target.
 */
export interface ScreenOutputArchetypeSpotlightResponse {
	archetype: { id: number; name: string; colors: string | null };
	/** The Archetype's Players in the scope. */
	playerCount: number;
	/** % of the scope's classified Players on this Archetype. */
	metaShare: number;
	/** Pilots that reached the conversion target. */
	convertedCount: number | null;
	/** The Archetype's Conversion Rate inside the scope. */
	conversionRate: number | null;
	/** The pilots by position, unplaced pilots last. */
	pilots: ScreenOutputArchetypePilot[];
	/** The Archetype's most-included cards, most included first. */
	topCards: CardBreakdownEntry[];
}

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
