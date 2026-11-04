import type { ScreenOutputRoundClockResponse } from '~~/shared/types/screenOutputReads';
import { findRoundClockRound } from '~~/server/services/roundClock';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';

/** The Round this Screen's Round Clock shows: the one it picks, or the Current Round (ADR-0066). */
export default defineEventHandler(async (event): Promise<ScreenOutputRoundClockResponse> => {
	const { eventId, config: { roundId } } = await requireScreenOutputModeRead(event, 'round-clock');
	return await findRoundClockRound(eventId, roundId);
});
