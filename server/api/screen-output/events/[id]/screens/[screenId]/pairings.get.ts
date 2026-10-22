import type { ScreenOutputPairingsResponse } from '~~/shared/types/screenOutputReads';
import { findRoundMatches } from '~~/server/services/roundMatches';
import { requireScreenOutputModeRead, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

/** The Matches of the Round this Screen's Pairings mode names, in table order (#751). */
export default defineEventHandler(async (event): Promise<ScreenOutputPairingsResponse> => {
	const { eventId, config: { roundId } } = await requireScreenOutputModeRead(event, 'pairings');
	const result = roundId ? await findRoundMatches(eventId, roundId) : null;
	if (!result)
		screenOutputReadNotFound();

	return result;
});
