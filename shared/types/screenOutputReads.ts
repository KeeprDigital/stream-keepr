import type { FeatureMatchResponse, MatchResponse, PhaseResponse, PlayerResponse, RoundResponse } from '~~/shared/api';
import type { TopCutBracket } from '~~/shared/modules/top-cut-bracket';
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
}

/** What a Pairings Screen renders from: its Round, and that Round's Matches in table order. */
export interface ScreenOutputPairingsResponse {
	round: RoundResponse;
	matches: ScreenOutputRoundMatch[];
}

/** One side of a Head-to-Head: the Player, their current record and points, and their deck as a broadcast names it. */
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

/** An earlier reported Match between a Head-to-Head's two Players at this Event. */
export interface ScreenOutputHeadToHeadEarlierMatch {
	matchId: number;
	roundId: number;
	roundName: string;
	roundNumber: number;
	phaseName: string;
	/** How it ended: won by the first or second Player, or drawn. */
	outcome: HeadToHeadOutcome;
	/** Its Game Score from the first Player's side. */
	gameScore: string;
}

/** How an earlier Match between a Head-to-Head's two Players ended, from the first Player's side. */
export type HeadToHeadOutcome = 'player1' | 'player2' | 'draw';

/** What a Head-to-Head Screen renders from: its two Players, and their earlier Matches oldest first. */
export interface ScreenOutputHeadToHeadResponse {
	/** `null` for a side no Player fills, such as an empty Slot's. */
	player1: ScreenOutputHeadToHeadPlayer | null;
	player2: ScreenOutputHeadToHeadPlayer | null;
	earlierMatches: ScreenOutputHeadToHeadEarlierMatch[];
}

/**
 * What a Top Cut Bracket Screen renders from: the Phase its configuration names, and
 * the bracket derived from that Phase's Rounds and their Matches (#752). A
 * Phase outside the Event, or one since deleted, answers `null` and an empty
 * bracket.
 */
export interface ScreenOutputTopCutResponse {
	phase: PhaseResponse | null;
	bracket: TopCutBracket;
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
