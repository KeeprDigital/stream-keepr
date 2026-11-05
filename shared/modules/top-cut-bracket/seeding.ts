/** What every Top Cut Bracket shares, however it is filled: its sizes, where Seeds sit, and how a column is named. */

/** The bracket sizes an operator may set, each a power of two. */
export const TOP_CUT_BRACKET_SIZES = [4, 8, 16, 32] as const;
export type TopCutBracketSize = typeof TOP_CUT_BRACKET_SIZES[number];

/**
 * The Seeds in the order a bracket of `size` seats them, top to bottom: each
 * pair of neighbours meets in the first Round (1v8, 4v5, 2v7, 3v6 for 8), and
 * the best Seeds meet as late as they can.
 */
export function standardSeedOrder(size: number): number[] {
	let order = [1];
	while (order.length < size) {
		const count = order.length * 2;
		order = order.flatMap(seed => [seed, count + 1 - seed]);
	}
	return order;
}

/** A column no Round names, named by how many positions it holds. */
export function bracketColumnName(positionCount: number): string {
	if (positionCount === 1)
		return 'Final';
	if (positionCount === 2)
		return 'Semifinals';
	if (positionCount === 4)
		return 'Quarterfinals';
	return `Round of ${positionCount * 2}`;
}
