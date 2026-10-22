import type { ScreenOutputHeadToHeadResponse } from '~~/shared/types/screenOutputReads';
import { findHeadToHead } from '~~/server/services/headToHead';
import { requireScreenOutputModeRead, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

/**
 * The two Players this Screen's Head-to-head mode shows, from its Feature Match
 * Slot or as picked, with their earlier meetings (#760).
 */
export default defineEventHandler(async (event): Promise<ScreenOutputHeadToHeadResponse> => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'head-to-head');
	const result = await findHeadToHead(eventId, config);
	if (!result)
		screenOutputReadNotFound();

	return result;
});
