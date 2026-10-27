import type { DbRound } from '~~/server/db/schema';
import { matchService } from '~~/server/services/match';
import { roundService } from '~~/server/services/round';
import { isRoundComplete } from '~~/shared/utils/roundCompletion';
import { isMeleeManagedRound } from '~~/shared/utils/roundControl';

/**
 * What a Live Results tick does next: poll the Current Round's Match Results,
 * probe a Round for pairings, or nothing (every Round is complete).
 */
export type LiveResultsTarget
	= | { kind: 'results'; round: DbRound }
		| { kind: 'probe'; round: DbRound }
		| { kind: 'idle' };

/** A Round's Melee pairings as the Current Round reads them. */
export interface RoundPairingStats {
	/** Matches stored from Melee. */
	matchCount: number;
	/** Every Match has a result or is a bye, or the next Round is paired. */
	complete: boolean;
}

export interface CurrentRoundResolution {
	current: DbRound | null;
	target: LiveResultsTarget;
}

/**
 * The Current Round is the last Round with pairings. Live Results polls it while
 * it is incomplete; once complete it probes the next Round, or the first when no
 * Round is paired yet. `orderedRounds` are the Melee-managed Rounds in Round order.
 */
export function resolveCurrentRound(
	orderedRounds: readonly DbRound[],
	stats: ReadonlyMap<number, RoundPairingStats>,
): CurrentRoundResolution {
	const currentIndex = orderedRounds.findLastIndex(round => (stats.get(round.id)?.matchCount ?? 0) > 0);
	const current = currentIndex >= 0
		? orderedRounds[currentIndex]!
		: null;
	if (current && !stats.get(current.id)!.complete) {
		return {
			current,
			target: { kind: 'results', round: current },
		};
	}
	const next = orderedRounds[currentIndex + 1];
	return {
		current,
		target: next
			? { kind: 'probe', round: next }
			: { kind: 'idle' },
	};
}

/** Resolve an Event's Current Round from its stored Rounds and Melee Matches. */
export async function loadCurrentRound(eventId: number): Promise<CurrentRoundResolution> {
	const [allRounds, allMatches] = await Promise.all([
		roundService().findByEventId(eventId),
		matchService().findByEventId(eventId),
	]);
	const orderedRounds = allRounds.filter(round => isMeleeManagedRound(round));
	const meleeMatchesByRound = Map.groupBy(
		allMatches.filter(match => match.externalSource === 'melee'),
		match => match.roundId,
	);
	const stats = new Map(orderedRounds.map((round, index) => {
		const matches = meleeMatchesByRound.get(round.id) ?? [];
		const next = orderedRounds[index + 1];
		const nextRoundHasPairings = next != null && (meleeMatchesByRound.get(next.id)?.length ?? 0) > 0;
		return [
			round.id,
			{
				matchCount: matches.length,
				complete: isRoundComplete(matches, nextRoundHasPairings),
			},
		];
	}));
	return resolveCurrentRound(orderedRounds, stats);
}
