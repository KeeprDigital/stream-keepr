import type { ScreenOutputRoundClockResponse } from '~~/shared/types/screenOutputReads';
import { loadCurrentRound } from '~~/server/modules/melee-sync/liveResults/currentRound';
import { roundService } from '~~/server/services/round';

/**
 * The Round a Round Clock Screen shows, with its operator-entered timing
 * (ADR-0066): the Round it picks, or the Current Round when it picks none. A
 * Round outside the Event, or no Current Round yet, shows none.
 */
export async function findRoundClockRound(eventId: number, roundId: number | undefined): Promise<ScreenOutputRoundClockResponse> {
	const round = roundId
		? await roundService().findById(roundId, eventId)
		: (await loadCurrentRound(eventId)).current;
	if (!round)
		return { round: null };

	return {
		round: {
			id: round.id,
			name: round.name,
			startedAt: round.startedAt?.toISOString() ?? null,
			durationMinutes: round.durationMinutes,
		},
	};
}
