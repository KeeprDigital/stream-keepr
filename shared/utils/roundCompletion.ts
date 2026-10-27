/** A Match as Round completion reads it. */
export interface RoundCompletionMatch {
	hasResult: boolean;
	isBye: boolean;
}

/**
 * A Round is complete when every Match in it has a result or is a bye, or when
 * the next Round in Round order is paired: Rounds run strictly in sequence, so
 * pairing the next one means this one is done. A Round with no Matches is
 * complete only once the next is paired.
 */
export function isRoundComplete(
	matches: readonly RoundCompletionMatch[],
	nextRoundHasPairings: boolean,
): boolean {
	if (nextRoundHasPairings)
		return true;
	return matches.length > 0 && matches.every(match => match.hasResult || match.isBye);
}
