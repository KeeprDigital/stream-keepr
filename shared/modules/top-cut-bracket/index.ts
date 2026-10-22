/**
 * A Top Cut bracket, derived from one Phase's Rounds and their Matches (#752).
 *
 * Nothing marks a Phase as a top cut: the operator chooses one, and its Rounds,
 * in order, are the bracket's columns. Its first Round sets the bracket's size.
 * Each Match is placed so its winner advances into the next column's slot
 * above it, which the next Round's pairings decide where they exist and table
 * order decides where they do not. A slot no Match fills yet is pending, its
 * entrants the winners advancing into it so far.
 */

/** One side of a Match: its Player, or the Match's own record of a side no Player holds. */
export interface BracketEntrant {
	/** The seated Player; `null` when the side names no Player of the Event. */
	playerId: number | null;
	name: string;
}

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
 * - `awaiting`: no Match fills the slot yet.
 */
export type BracketSlotStatus = 'reported' | 'bye' | 'unreported' | 'awaiting';

export interface BracketSlot {
	matchId: number | null;
	tableNumber: number | null;
	entrants: [BracketEntrant | null, BracketEntrant | null];
	gameWins: [number | null, number | null];
	gameDraws: number | null;
	/** Which entrant advances; `null` while undecided, or for a drawn Match. */
	winner: 0 | 1 | null;
	status: BracketSlotStatus;
}

export interface BracketColumn {
	/** The Round this column shows; `null` for one the Phase does not hold yet. */
	roundId: number | null;
	name: string;
	slots: BracketSlot[];
}

export interface TopCutBracket {
	/** How many entrants the first column seats: the first Round's Matches, rounded up to a whole bracket. */
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
function pendingColumnName(slotCount: number): string {
	if (slotCount === 1)
		return 'Final';
	if (slotCount === 2)
		return 'Semifinals';
	if (slotCount === 4)
		return 'Quarterfinals';
	return `Round of ${slotCount * 2}`;
}

function sameEntrant(a: BracketEntrant, b: BracketEntrant): boolean {
	return a.playerId != null && b.playerId != null ? a.playerId === b.playerId : a.name === b.name;
}

function seats(match: BracketMatchInput, entrant: BracketEntrant): boolean {
	return [match.player1, match.player2].some(side => side != null && sameEntrant(side, entrant));
}

/** Table order: by table number, untabled Matches last, otherwise as given. */
function inTableOrder(matches: readonly BracketMatchInput[]): BracketMatchInput[] {
	return [...matches].sort((a, b) =>
		(a.tableNumber ?? Number.POSITIVE_INFINITY) - (b.tableNumber ?? Number.POSITIVE_INFINITY));
}

/** Which side won: a bye's seated side, or the side with more game wins. */
function matchWinner(match: BracketMatchInput): 0 | 1 | null {
	if (match.isBye)
		return match.player1 || !match.player2 ? 0 : 1;
	if (!match.hasResult || match.player1GameWins == null || match.player2GameWins == null || match.player1GameWins === match.player2GameWins)
		return null;
	return match.player1GameWins > match.player2GameWins ? 0 : 1;
}

function matchSlot(match: BracketMatchInput): BracketSlot {
	return {
		matchId: match.matchId,
		tableNumber: match.tableNumber,
		entrants: [match.player1, match.player2],
		gameWins: [match.player1GameWins, match.player2GameWins],
		gameDraws: match.gameDraws,
		winner: matchWinner(match),
		status: match.isBye ? 'bye' : match.hasResult ? 'reported' : 'unreported',
	};
}

function awaitingSlot(entrants: [BracketEntrant | null, BracketEntrant | null]): BracketSlot {
	return { matchId: null, tableNumber: null, entrants, gameWins: [null, null], gameDraws: null, winner: null, status: 'awaiting' };
}

function byeSlot(entrant: BracketEntrant): BracketSlot {
	return { matchId: null, tableNumber: null, entrants: [entrant, null], gameWins: [null, null], gameDraws: null, winner: 0, status: 'bye' };
}

function advancing(slot: BracketSlot | undefined): BracketEntrant | null {
	return slot?.winner == null ? null : slot.entrants[slot.winner];
}

/**
 * Places each Round's Matches into its column, latest Round first: a Match in
 * a later column pulls the Matches its entrants came from into the two slots
 * that feed it, and every Match nothing pulls takes the first free slot in
 * table order.
 */
function placeMatches(rounds: readonly BracketRoundInput[], slotCounts: readonly number[]): Array<Array<BracketMatchInput | null>> {
	const placed = slotCounts.map(count => Array.from<BracketMatchInput | null>({ length: count }).fill(null));

	for (let column = rounds.length - 1; column >= 0; column--) {
		const slots = placed[column]!;
		for (const match of inTableOrder(rounds[column]!.matches)) {
			if (slots.includes(match))
				continue;
			const free = slots.indexOf(null);
			if (free >= 0)
				slots[free] = match;
		}

		if (column === 0)
			continue;
		const feeders = placed[column - 1]!;
		const earlier = inTableOrder(rounds[column - 1]!.matches);
		slots.forEach((match, position) => {
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

	return placed;
}

/**
 * The bracket of one Phase, from its Rounds in order. Its first Round sets the
 * size; a Phase holding more Rounds than that size needs (its byes left out of
 * the first Round) widens the first columns to fit them.
 */
export function deriveTopCutBracket(rounds: readonly BracketRoundInput[]): TopCutBracket {
	const firstRoundMatches = rounds[0]?.matches.length ?? 0;
	const columnsForSize = firstRoundMatches > 0 ? Math.log2(nextPowerOfTwo(firstRoundMatches)) + 1 : 0;
	const columnCount = Math.max(rounds.length, columnsForSize);
	if (columnCount === 0)
		return EMPTY_TOP_CUT_BRACKET;

	const slotCounts = Array.from({ length: columnCount }, (_, column) =>
		Math.max(2 ** (columnCount - 1 - column), rounds[column]?.matches.length ?? 0));
	const placed = placeMatches(rounds, slotCounts);

	const columns: BracketColumn[] = [];
	for (let column = 0; column < columnCount; column++) {
		const round = rounds[column];
		const previous = columns[column - 1]?.slots;
		const slots = Array.from({ length: slotCounts[column]! }, (_, position) => {
			const match = placed[column]?.[position];
			if (match)
				return matchSlot(match);
			const entrants: BracketSlot['entrants'] = previous
				? [advancing(previous[position * 2]), advancing(previous[position * 2 + 1])]
				: [null, null];
			if (!entrants[0] && !entrants[1]) {
				// A Round that leaves a bye out: the next Round seats a Player here no Match feeds.
				const next = placed[column + 1]?.[Math.floor(position / 2)];
				const seeded = next && (position % 2 === 0 ? next.player1 : next.player2);
				if (seeded)
					return byeSlot(seeded);
			}
			return awaitingSlot(entrants);
		});
		columns.push({ roundId: round?.roundId ?? null, name: round?.name ?? pendingColumnName(slots.length), slots });
	}

	const final = columns.at(-1)!.slots;
	return {
		size: slotCounts[0]! * 2,
		columns,
		champion: final.length === 1 ? advancing(final[0]) : null,
	};
}
