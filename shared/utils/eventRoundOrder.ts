/**
 * Which Round's Round Standings a reading compares with, chosen from the
 * Event's Rounds in Round order: Phase sort order, then round number. A Round
 * holding no Round Standings, such as a manual one, is passed over.
 */

/** One of the Event's Rounds, in Round order, and whether it holds Round Standings. */
export interface EventRound {
	id: number;
	phaseId: number;
	hasStandings: boolean;
}

/**
 * The Round a Position Change is measured against (#755): the nearest Round
 * before `roundId` holding Round Standings. Current standings (`roundId` null)
 * stand as the latest Round holding them, so they compare with the one before
 * it. `null` for the first Round, or a Round outside the Event.
 */
export function previousStandingsRoundId(rounds: readonly EventRound[], roundId: number | null): number | null {
	const withStandings = (upTo: number) => rounds.slice(0, upTo).filter(round => round.hasStandings);
	if (roundId == null)
		return withStandings(rounds.length).at(-2)?.id ?? null;
	const index = rounds.findIndex(round => round.id === roundId);
	return index > 0
		? withStandings(index).at(-1)?.id ?? null
		: null;
}

/**
 * The Round whose Round Standings seed a Phase's Top Cut Bracket (#759): the
 * last Round before the Phase's first Round that holds Round Standings, so a
 * Player's seed is their final position before the Phase began. `null` when
 * no earlier Round holds them, or the Phase holds no Round.
 */
export function seedingRoundId(rounds: readonly EventRound[], phaseId: number): number | null {
	const first = rounds.find(round => round.phaseId === phaseId);
	return first
		? previousStandingsRoundId(rounds, first.id)
		: null;
}
