import type { PlayerGameData } from '../types/game';
import type { HeadToHeadOutcome, ScreenOutputHeadToHeadEarlierMatch, ScreenOutputHeadToHeadPlayer, ScreenOutputHeadToHeadResponse } from '../types/screenOutputReads';
import type { MatchResultFacts, MatchSideOutcome } from './matchFromPlayerSide';
import { resolvePlayerDeckIdentity } from './gameData';
import { formatGameScore, readMatchFromPlayerSide } from './matchFromPlayerSide';

/** A record and points: a Player's own, or as one Round's Standings hold them. */
interface RecordFacts {
	wins: number | null;
	losses: number | null;
	draws: number | null;
	points: number | null;
}

/** What a Head-to-Head reads of one Player. */
export interface HeadToHeadPlayerFacts {
	player: RecordFacts & { id: number; name: string; pronouns: string | null; gameData: PlayerGameData | null };
	/** Their assigned Archetype, if any. */
	archetype: { name: string; colors: string | null } | null;
	/** Their Round Standings in the latest Round holding any for them; `null` when none does. */
	latestStanding: RecordFacts | null;
}

/** A Match of the Event, with where it was played. */
export interface HeadToHeadMatchFacts extends MatchResultFacts {
	id: number;
	player2Id: number | null;
	roundId: number;
	roundName: string;
	roundNumber: number;
	phaseName: string;
	phaseSortOrder: number;
	sortOrder: number;
	resultString: string | null;
}

export interface HeadToHeadFacts {
	player1: HeadToHeadPlayerFacts | null;
	player2: HeadToHeadPlayerFacts | null;
	/** Matches of the Event; those not seating both Players are not earlier Matches between them. */
	matches: readonly HeadToHeadMatchFacts[];
	/** The Match the two are about to play, which is not an earlier Match between them; `null` when none is known. */
	currentMatchId: number | null;
}

function projectPlayer({ player, archetype, latestStanding }: HeadToHeadPlayerFacts): ScreenOutputHeadToHeadPlayer {
	const record = latestStanding ?? player;
	const deck = resolvePlayerDeckIdentity(archetype, player.gameData);
	return {
		id: player.id,
		name: player.name,
		pronouns: player.pronouns,
		wins: record.wins,
		losses: record.losses,
		draws: record.draws,
		points: record.points,
		deckName: deck.name,
		deckColors: deck.colors,
	};
}

function seatsBoth(match: HeadToHeadMatchFacts, a: number, b: number): boolean {
	return (match.player1Id === a && match.player2Id === b) || (match.player1Id === b && match.player2Id === a);
}

/**
 * A reported Match read from the first Player's side. One reported without game
 * wins reads as pending there; it is a result all the same, just one naming no
 * winner. A bye never seats both Players.
 */
const OUTCOME_FROM_FIRST_SIDE: Record<MatchSideOutcome, HeadToHeadOutcome> = {
	win: 'player1',
	loss: 'player2',
	draw: 'draw',
	pending: 'reported',
	bye: 'reported',
};

function byPlayOrder(a: HeadToHeadMatchFacts, b: HeadToHeadMatchFacts): number {
	return a.phaseSortOrder - b.phaseSortOrder
		|| a.roundNumber - b.roundNumber
		|| a.sortOrder - b.sortOrder
		|| a.id - b.id;
}

/**
 * The earlier reported Matches between two Players, oldest first, each read
 * from the first Player's side. A Match not yet reported, and the one the two
 * are about to play, are not earlier Matches.
 */
function projectEarlierMatches(facts: HeadToHeadFacts, player1Id: number, player2Id: number): ScreenOutputHeadToHeadEarlierMatch[] {
	return facts.matches
		.filter(match => match.id !== facts.currentMatchId && match.hasResult && !match.isBye && seatsBoth(match, player1Id, player2Id))
		.sort(byPlayOrder)
		.map((match) => {
			const side = readMatchFromPlayerSide(match, player1Id);
			return {
				matchId: match.id,
				roundId: match.roundId,
				roundName: match.roundName,
				roundNumber: match.roundNumber,
				phaseName: match.phaseName,
				outcome: OUTCOME_FROM_FIRST_SIDE[side.outcome],
				gameScore: formatGameScore(side),
				resultString: match.resultString,
			};
		});
}

/**
 * A Head-to-Head of two Players at one Event (#760): each Player's current
 * record, points and deck, and the earlier Matches between them.
 *
 * A record is the Player's latest Round Standings, as Standings fixed at that
 * Round shows it, else the Player's own record, which an Event without synced
 * Round Standings keeps current.
 */
export function projectHeadToHead(facts: HeadToHeadFacts): ScreenOutputHeadToHeadResponse {
	const player1 = facts.player1
		? projectPlayer(facts.player1)
		: null;
	const player2 = facts.player2
		? projectPlayer(facts.player2)
		: null;
	return {
		player1,
		player2,
		earlierMatches: player1 && player2
			? projectEarlierMatches(facts, player1.id, player2.id)
			: [],
	};
}
