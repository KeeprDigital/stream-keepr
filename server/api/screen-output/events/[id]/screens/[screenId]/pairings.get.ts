import type { ScreenOutputPairingsResponse } from '~~/shared/types/screenOutputReads';
import { findRoundPairings } from '~~/server/services/roundPairings';
import { requireScreenOutputModeRead, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

/** The Matches of the Round this Screen's Pairings mode names, in table order (#751). */
export default defineEventHandler(async (event): Promise<ScreenOutputPairingsResponse> => {
	const { eventId, config: { roundId } } = await requireScreenOutputModeRead(event, 'pairings');
	const result = roundId ? await findRoundPairings(eventId, roundId) : null;
	if (!result)
		screenOutputReadNotFound();

	return result;
});
