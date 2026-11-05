/**
 * A Manual Bracket: a Top Cut Bracket its operator fills in by hand, for an
 * Event whose top cut Stream Keepr holds no Rounds or Matches of, such as a
 * One Piece Card Game Event (ADR-0075).
 *
 * The operator lists the entrants in Seed order, and the first column pairs
 * them in standard order (1v8, 4v5, 2v7, 3v6 for a bracket of 8); a Seed left
 * empty is a bye for the entrant it meets. The operator then marks who
 * advances from each position, with a game score if they want one, and each
 * later column seats the entrants advancing into it. A mark is held by its
 * position and side, so correcting an entrant keeps the marks around them.
 */

import type { BracketColumn, BracketEntrant, BracketPosition, TopCutBracket } from './index';
import type { TopCutBracketSize } from './seeding';
import { bracketColumnName, standardSeedOrder } from './seeding';

/** A side of a Manual Bracket: a Player of the Event, or a name the operator typed. */
export type ManualBracketEntrant = { playerId: number } | { name: string };

/** Who advanced from a position, by side, and the game score if the operator gave one. */
export interface ManualBracketResult {
	winner: 0 | 1;
	gameWins?: [number, number] | null;
}

/**
 * What a Manual Bracket holds: its size, its entrants by Seed (Seed 1 first,
 * `null` for a Seed not entered), and the results marked in each column, by
 * position.
 */
export interface ManualBracket {
	size: TopCutBracketSize;
	entrants: Array<ManualBracketEntrant | null>;
	results: Array<Array<ManualBracketResult | null>>;
}

/** How a Manual Bracket's entrant shows: resolved by the reader, at its Seed. */
export type ManualEntrantResolver = (entrant: ManualBracketEntrant, seed: number) => BracketEntrant | null;

/** How many positions each column of a bracket of `size` holds, the first column first. */
export function manualBracketPositionCounts(size: number): number[] {
	const counts: number[] = [];
	for (let count = Math.floor(size / 2); count >= 1; count = Math.floor(count / 2))
		counts.push(count);
	return counts;
}

/** The two Seeds the first column's position `position` seats, top side first. */
export function manualBracketSeedsAt(size: number, position: number): [number, number] {
	const order = standardSeedOrder(size);
	return [order[position * 2]!, order[position * 2 + 1]!];
}

/** A position as the bracket derives it, and whether no entrant can ever advance from it. */
interface DerivedPosition {
	position: BracketPosition;
	void: boolean;
}

function derivePosition(
	entrants: [BracketEntrant | null, BracketEntrant | null],
	sideVoid: [boolean, boolean],
	result: ManualBracketResult | null | undefined,
): DerivedPosition {
	const position: BracketPosition = {
		matchId: null,
		tableNumber: null,
		entrants,
		gameWins: [null, null],
		gameDraws: null,
		winner: null,
		status: 'awaiting',
	};
	const [top, bottom] = entrants;
	if (top && bottom) {
		if (result) {
			position.winner = result.winner;
			position.gameWins = result.gameWins
				? [result.gameWins[0], result.gameWins[1]]
				: [null, null];
			position.status = 'reported';
		}
		else {
			position.status = 'unreported';
		}
		return { position, void: false };
	}
	// One side can never be filled, so the entrant on the other advances unplayed.
	const seated = top
		? 0
		: bottom ? 1 : null;
	if (seated != null && sideVoid[seated === 0
		? 1
		: 0]) {
		position.winner = seated;
		position.status = 'bye';
	}
	return { position, void: sideVoid[0] && sideVoid[1] };
}

function advancing(derived: DerivedPosition | undefined): BracketEntrant | null {
	const position = derived?.position;
	return position?.winner == null
		? null
		: position.entrants[position.winner];
}

/**
 * The Top Cut Bracket a Manual Bracket shows. Each entrant is shown as
 * `entrantOf` resolves them, and one it resolves to nothing is an empty Seed.
 * A result is read only at a position seating both its entrants.
 */
export function deriveManualTopCutBracket(manual: ManualBracket, entrantOf: ManualEntrantResolver): TopCutBracket {
	const counts = manualBracketPositionCounts(manual.size);
	if (counts.length === 0)
		return { size: 0, columns: [], champion: null };

	const seeded = (seed: number): BracketEntrant | null => {
		const entrant = manual.entrants[seed - 1];
		return entrant
			? entrantOf(entrant, seed)
			: null;
	};

	const derived: DerivedPosition[][] = [];
	counts.forEach((count, column) => {
		const previous = derived[column - 1];
		derived.push(Array.from({ length: count }, (_, position) => {
			const result = manual.results[column]?.[position];
			if (!previous) {
				const entrants = manualBracketSeedsAt(manual.size, position).map(seeded) as [BracketEntrant | null, BracketEntrant | null];
				return derivePosition(entrants, [!entrants[0], !entrants[1]], result);
			}
			const feeders = [previous[position * 2], previous[position * 2 + 1]] as const;
			return derivePosition(
				[
					advancing(feeders[0]),
					advancing(feeders[1]),
				],
				[feeders[0]?.void ?? true, feeders[1]?.void ?? true],
				result,
			);
		}));
	});

	const columns: BracketColumn[] = derived.map((positions, column) => ({
		roundId: null,
		name: bracketColumnName(counts[column]!),
		positions: positions.map(({ position }) => position),
	}));
	return {
		size: manual.size,
		columns,
		champion: advancing(derived.at(-1)?.[0]),
	};
}

/** The Manual Bracket with the entrant at `seed` set, or cleared with `null`. */
export function withManualBracketEntrant(manual: ManualBracket, seed: number, entrant: ManualBracketEntrant | null): ManualBracket {
	if (seed < 1 || seed > manual.size)
		return manual;
	const entrants = Array.from({
		length: Math.max(manual.entrants.length, seed),
	}, (_, index) => manual.entrants[index] ?? null);
	entrants[seed - 1] = entrant;
	while (entrants.length > 0 && entrants.at(-1) == null)
		entrants.pop();
	return { ...manual, entrants };
}

/** The Manual Bracket with the result at `column` and `position` marked, or cleared with `null`. */
export function withManualBracketResult(manual: ManualBracket, column: number, position: number, result: ManualBracketResult | null): ManualBracket {
	const counts = manualBracketPositionCounts(manual.size);
	if (column < 0 || column >= counts.length || position < 0 || position >= counts[column]!)
		return manual;
	const results = Array.from({
		length: Math.max(manual.results.length, column + 1),
	}, (_, index) => [
		...(manual.results[index] ?? []),
	]);
	const positions = results[column]!;
	while (positions.length <= position)
		positions.push(null);
	positions[position] = result;
	while (positions.length > 0 && positions.at(-1) == null)
		positions.pop();
	while (results.length > 0 && results.at(-1)!.length === 0)
		results.pop();
	return { ...manual, results };
}

/**
 * The Manual Bracket at another size. Its entrants keep their Seeds, those
 * past the new size dropped; its results are cleared, since every column
 * moves to another position in the new bracket.
 */
export function resizeManualBracket(manual: ManualBracket, size: TopCutBracketSize): ManualBracket {
	if (size === manual.size)
		return manual;
	return {
		size,
		entrants: manual.entrants.slice(0, size),
		results: [],
	};
}
