/**
 * A Top Cut bracket, derived from one Phase's Rounds and their Matches (#752).
 *
 * Nothing marks a Phase as a top cut: the operator chooses one, and its Rounds,
 * in order, are the bracket's columns. Its first Round sets the bracket's size,
 * unless the operator sets a larger one (#906). Each Match is placed so its
 * winner advances into the next column's position above it. With Seeds, the
 * first Round is placed by Seed in standard order and each later Match where
 * its Players advance from, so no position moves as Rounds are paired; without
 * them, the next Round's pairings decide where they exist and table order where
 * they do not. A position no Match fills yet is pending, its entrants the
 * winners advancing into it so far.
 */

import type { PlayerDeckIdentity } from '../../utils/gameData';

/** One side of a Match: its Player, or the Match's own record of a side no Player holds. */
export interface BracketEntrant {
	/** The seated Player; `null` when the side names no Player of the Event. */
	playerId: number | null;
	name: string;
	/**
	 * The Player's seed as shown: their final position in the last Round
	 * Standings before the Phase (#759). `null` when they have none; absent
	 * when the Screen does not show seeds. Placement reads Seeds from
	 * `TopCutBracketOptions.seeds` instead, whether or not they show.
	 */
	seed?: number | null;
	/**
	 * The Player's deck as a broadcast names it: their assigned Archetype, else
	 * their Deck List's deck name (#759). `null` when they have neither; absent
	 * when the Screen does not show Archetypes.
	 */
	deck?: NamedPlayerDeckIdentity | null;
}

/** A Player's deck identity that names a deck. */
export type NamedPlayerDeckIdentity = PlayerDeckIdentity & { name: string };

/** One Match of a Round, as the bracket reads it. */
export interface BracketMatchInput {
	matchId: number;
	tableNumber: number | null;
	/** `null` for a side no Player and no name fills, such as a bye's empty seat. */
	player1: BracketEntrant | null;
	player2: BracketEntrant | null;
	isBye: boolean;
	hasResult: boolean;
	player1GameWins: number | null;
	player2GameWins: number | null;
	gameDraws: number | null;
}

/** One Round of the Phase, its Matches in any order. */
export interface BracketRoundInput {
	roundId: number;
	name: string;
	matches: BracketMatchInput[];
}

/**
 * - `reported`: the Match has a result.
 * - `bye`: one entrant advances unplayed, whether the Round records the bye as
 *   a Match or leaves the seat empty.
 * - `unreported`: the Match is paired and has no result yet.
 * - `awaiting`: no Match fills the position yet.
 */
export type BracketPositionStatus = 'reported' | 'bye' | 'unreported' | 'awaiting';

export interface BracketPosition {
	matchId: number | null;
	tableNumber: number | null;
	entrants: [BracketEntrant | null, BracketEntrant | null];
	gameWins: [number | null, number | null];
	gameDraws: number | null;
	/** Which entrant advances; `null` while undecided, or for a drawn Match. */
	winner: 0 | 1 | null;
	status: BracketPositionStatus;
}

export interface BracketColumn {
	/** The Round this column shows; `null` for one the Phase does not hold yet. */
	roundId: number | null;
	name: string;
	positions: BracketPosition[];
}

/** A Player the Phase seeds, as the bracket shows them, and their Seed. */
export interface SeededPlayer {
	seed: number;
	entrant: BracketEntrant;
}

export interface TopCutBracketOptions {
	/**
	 * The operator's bracket size (#906), rounded up to a power of two. Unset,
	 * or smaller than the first Round implies, the first Round sets it.
	 */
	size?: number | null;
	/**
	 * The Phase's seeded Players, in any order. A Player absent here has no
	 * Seed. Byes go to the best Seeds the first Round leaves out, so those
	 * must be here for a bye to name its Player before the next Round does.
	 */
	seeds?: readonly SeededPlayer[];
}

export interface TopCutBracket {
	/** How many entrants the first column seats: the first Round's Matches and the byes it leaves out, rounded up to a whole bracket, or the operator's size when larger. */
	size: number;
	columns: BracketColumn[];
	/** The winner of the Final, once it has one. */
	champion: BracketEntrant | null;
}

export const EMPTY_TOP_CUT_BRACKET: TopCutBracket = { size: 0, columns: [], champion: null };

function nextPowerOfTwo(value: number): number {
	let power = 1;
	while (power < value)
		power *= 2;
	return power;
}

/** A column the Phase does not hold yet, named by how many Matches it seats. */
function pendingColumnName(positionCount: number): string {
	if (positionCount === 1)
		return 'Final';
	if (positionCount === 2)
		return 'Semifinals';
	if (positionCount === 4)
		return 'Quarterfinals';
	return `Round of ${positionCount * 2}`;
}

function sameEntrant(a: BracketEntrant, b: BracketEntrant): boolean {
	return a.playerId != null && b.playerId != null
		? a.playerId === b.playerId
		: a.name === b.name;
}

function seats(match: BracketMatchInput, entrant: BracketEntrant): boolean {
	return [match.player1, match.player2].some(side => side != null && sameEntrant(side, entrant));
}

/** Table order: by table number, untabled Matches last, otherwise as given. */
function inTableOrder(matches: readonly BracketMatchInput[]): BracketMatchInput[] {
	return [...matches].sort((a, b) =>
		(a.tableNumber ?? Number.POSITIVE_INFINITY) - (b.tableNumber ?? Number.POSITIVE_INFINITY));
}

/**
 * The Seeds in the order a bracket of `size` seats them, top to bottom: each
 * pair of neighbours meets in the first Round (1v8, 4v5, 2v7, 3v6 for 8), and
 * the best Seeds meet as late as they can.
 */
function standardSeedOrder(size: number): number[] {
	let order = [1];
	while (order.length < size) {
		const count = order.length * 2;
		order = order.flatMap(seed => [seed, count + 1 - seed]);
	}
	return order;
}

/** Which side won: a bye's seated side, or the side with more game wins. */
function matchWinner(match: BracketMatchInput): 0 | 1 | null {
	if (match.isBye) {
		return match.player1 || !match.player2
			? 0
			: 1;
	}
	if (!match.hasResult || match.player1GameWins == null || match.player2GameWins == null || match.player1GameWins === match.player2GameWins)
		return null;
	return match.player1GameWins > match.player2GameWins
		? 0
		: 1;
}

function matchPosition(match: BracketMatchInput): BracketPosition {
	return {
		matchId: match.matchId,
		tableNumber: match.tableNumber,
		entrants: [match.player1, match.player2],
		gameWins: [match.player1GameWins, match.player2GameWins],
		gameDraws: match.gameDraws,
		winner: matchWinner(match),
		status: match.isBye
			? 'bye'
			: match.hasResult ? 'reported' : 'unreported',
	};
}

function awaitingPosition(entrants: [BracketEntrant | null, BracketEntrant | null]): BracketPosition {
	return {
		matchId: null,
		tableNumber: null,
		entrants,
		gameWins: [null, null],
		gameDraws: null,
		winner: null,
		status: 'awaiting',
	};
}

function byePosition(entrant: BracketEntrant): BracketPosition {
	return {
		matchId: null,
		tableNumber: null,
		entrants: [entrant, null],
		gameWins: [null, null],
		gameDraws: null,
		winner: 0,
		status: 'bye',
	};
}

function advancing(position: BracketPosition | undefined): BracketEntrant | null {
	return position?.winner == null
		? null
		: position.entrants[position.winner];
}

/** Each column's Matches by position, and the first column's byes no Match records. */
interface Placement {
	matches: Array<Array<BracketMatchInput | null>>;
	byes: Array<BracketEntrant | null>;
}

function emptyPlacement(positionCounts: readonly number[]): Placement {
	return {
		matches: positionCounts.map(count => Array.from<BracketMatchInput | null>({ length: count }).fill(null)),
		byes: Array.from<BracketEntrant | null>({ length: positionCounts[0] ?? 0 }).fill(null),
	};
}

/** Puts each Match into the first position left free, in the order given. */
function fillFree(positions: Array<BracketMatchInput | null>, matches: readonly BracketMatchInput[], taken: (position: number) => boolean = () => false): void {
	for (const match of matches) {
		const free = positions.findIndex((placed, position) => placed == null && !taken(position));
		if (free >= 0)
			positions[free] = match;
	}
}

/**
 * Places the first Round by Seed, and each later Round where its Players
 * advance from, so nothing a later Round pairs moves an earlier position (#906).
 *
 * A first-Round Match takes the position standard order gives its best Seed.
 * Each position it leaves empty is a bye for the best Seed the first Round
 * leaves out, when that Seed is better than every Seed it seats: byes go to
 * the top. A Match no Seed places, in any column, takes the first position
 * left free in table order.
 */
function placeBySeed(rounds: readonly BracketRoundInput[], positionCounts: readonly number[], seedOf: (entrant: BracketEntrant) => number | null, seeds: readonly SeededPlayer[]): Placement {
	const placement = emptyPlacement(positionCounts);
	const { matches: placed, byes } = placement;
	const order = standardSeedOrder(positionCounts[0]! * 2);
	const positionOfSeed = (seed: number) => Math.floor(order.indexOf(seed) / 2);

	const first = placed[0]!;
	const firstMatches = inTableOrder(rounds[0]!.matches);
	const unseeded: BracketMatchInput[] = [];
	const seatedSeeds: number[] = [];
	for (const match of firstMatches) {
		const matchSeeds = [match.player1, match.player2]
			.map(entrant => entrant && seedOf(entrant))
			.filter((seed): seed is number => seed != null);
		seatedSeeds.push(...matchSeeds);
		const best = Math.min(...matchSeeds);
		const position = best <= order.length
			? positionOfSeed(best)
			: -1;
		if (position >= 0 && !first[position])
			first[position] = match;
		else
			unseeded.push(match);
	}

	let byeCount = first.length - firstMatches.length;
	const worstSeated = Math.max(0, ...seatedSeeds);
	for (const { seed, entrant } of [...seeds].sort((a, b) => a.seed - b.seed)) {
		if (byeCount <= 0 || seed >= worstSeated)
			break;
		if (seed > order.length || firstMatches.some(match => seats(match, entrant)))
			continue;
		const position = positionOfSeed(seed);
		if (first[position] || byes[position])
			continue;
		byes[position] = entrant;
		byeCount--;
	}
	fillFree(first, unseeded, position => byes[position] != null);

	for (let column = 1; column < rounds.length; column++) {
		const previous = placed[column - 1]!;
		const cameFrom = (entrant: BracketEntrant) => previous.findIndex((match, position) => {
			if (match)
				return seats(match, entrant);
			const bye = column === 1
				? byes[position]
				: null;
			return bye != null && sameEntrant(bye, entrant);
		});
		const positions = placed[column]!;
		const unplaced: BracketMatchInput[] = [];
		for (const match of inTableOrder(rounds[column]!.matches)) {
			const from = [match.player1, match.player2]
				.map(entrant => entrant
					? cameFrom(entrant)
					: -1)
				.find(position => position >= 0);
			const position = from == null
				? -1
				: Math.floor(from / 2);
			if (position >= 0 && !positions[position])
				positions[position] = match;
			else
				unplaced.push(match);
		}
		fillFree(positions, unplaced);
	}

	return placement;
}

/**
 * Places each Round's Matches into its column, latest Round first: a Match in
 * a later column pulls the Matches its entrants came from into the two positions
 * that feed it, and every Match nothing pulls takes the first free position in
 * table order.
 */
function placeByTableOrder(rounds: readonly BracketRoundInput[], positionCounts: readonly number[]): Placement {
	const placement = emptyPlacement(positionCounts);
	const placed = placement.matches;

	for (let column = rounds.length - 1; column >= 0; column--) {
		const positions = placed[column]!;
		fillFree(positions, inTableOrder(rounds[column]!.matches).filter(match => !positions.includes(match)));

		if (column === 0)
			continue;
		const feeders = placed[column - 1]!;
		const earlier = inTableOrder(rounds[column - 1]!.matches);
		positions.forEach((match, position) => {
			[match?.player1, match?.player2].forEach((entrant, side) => {
				const target = position * 2 + side;
				if (!entrant || target >= feeders.length || feeders[target])
					return;
				const feeder = earlier.find(candidate => seats(candidate, entrant) && !feeders.includes(candidate));
				if (feeder)
					feeders[target] = feeder;
			});
		});
	}

	return placement;
}

/**
 * How many positions the first column needs: the first Round's Matches, and
 * each bye it leaves out, which the next Round reveals by seating a Player no
 * first-Round Match seated. Until that Round exists such a bye cannot be told
 * from a smaller bracket.
 */
function firstColumnEntries(rounds: readonly BracketRoundInput[]): number {
	const firstRound = rounds[0]?.matches ?? [];
	const leftOut = (rounds[1]?.matches ?? [])
		.flatMap(match => [match.player1, match.player2])
		.filter(entrant => entrant != null && !firstRound.some(match => seats(match, entrant)));
	return firstRound.length + leftOut.length;
}

/** How many columns lead to the Final: the first Round's, or the operator's size when larger. */
function columnCountOf(rounds: readonly BracketRoundInput[], size: number | null | undefined): number {
	const entries = firstColumnEntries(rounds);
	const set = size != null && size > 1
		? Math.log2(nextPowerOfTwo(size))
		: 0;
	if (entries > 0)
		return Math.max(Math.log2(nextPowerOfTwo(entries)) + 1, set);
	return set || rounds.length;
}

/**
 * The bracket of one Phase, from its Rounds in order. Its first Round, with
 * the byes it leaves out, sets the size, and so how many columns lead to the
 * Final, unless `options.size` is larger. A Round past the Final, such as a
 * playoff for third place, is not shown, nor is a Match beyond its column's
 * positions. A Phase whose Rounds hold no Matches yet is one column per Round,
 * or as many as the set size needs, all pending.
 *
 * When `options.seeds` gives any first-Round Player a Seed, the Rounds are
 * placed by Seed; otherwise by the next Round's pairings and table order.
 */
export function deriveTopCutBracket(rounds: readonly BracketRoundInput[], options: TopCutBracketOptions = {}): TopCutBracket {
	if (rounds.length === 0)
		return EMPTY_TOP_CUT_BRACKET;
	const columnCount = columnCountOf(rounds, options.size);

	const shown = rounds.slice(0, columnCount);
	const positionCounts = Array.from({ length: columnCount }, (_, column) => 2 ** (columnCount - 1 - column));
	const seeds = options.seeds ?? [];
	const seedByPlayer = new Map(seeds.flatMap(({ seed, entrant }) => entrant.playerId == null
		? []
		: [
				[entrant.playerId, seed] as const,
			]));
	const seedOf = (entrant: BracketEntrant) => entrant.playerId == null
		? null
		: seedByPlayer.get(entrant.playerId) ?? null;
	const seeded = shown[0]!.matches.some(match => [match.player1, match.player2].some(entrant => entrant && seedOf(entrant) != null));
	const { matches: placed, byes } = seeded
		? placeBySeed(shown, positionCounts, seedOf, seeds)
		: placeByTableOrder(shown, positionCounts);

	const columns: BracketColumn[] = [];
	for (let column = 0; column < columnCount; column++) {
		const round = shown[column];
		const previous = columns[column - 1]?.positions;
		const positions = Array.from({ length: positionCounts[column]! }, (_, position) => {
			const match = placed[column]?.[position];
			if (match)
				return matchPosition(match);
			const bye = column === 0
				? byes[position]
				: null;
			if (bye)
				return byePosition(bye);
			const entrants: BracketPosition['entrants'] = previous
				? [
						advancing(previous[position * 2]),
						advancing(previous[position * 2 + 1]),
					]
				: [null, null];
			if (!entrants[0] && !entrants[1]) {
				// A Round that leaves a bye out: the next Round seats a Player here no Match feeds.
				const next = placed[column + 1]?.[Math.floor(position / 2)];
				const seeded = next && (position % 2 === 0
					? next.player1
					: next.player2);
				if (seeded)
					return byePosition(seeded);
			}
			return awaitingPosition(entrants);
		});
		columns.push({ roundId: round?.roundId ?? null, name: round?.name ?? pendingColumnName(positions.length), positions });
	}

	const final = columns.at(-1)!.positions;
	return {
		size: positionCounts[0]! * 2,
		columns,
		champion: final.length === 1
			? advancing(final[0])
			: null,
	};
}
