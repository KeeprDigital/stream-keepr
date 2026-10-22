import type { ScreenOutputHeadToHeadResponse } from '~~/shared/types/screenOutputReads';
import { findHeadToHead } from '~~/server/services/headToHead';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';

/**
 * The two Players this Screen's Head-to-Head mode shows, from its Feature Match
 * Slot or as picked, with their earlier Matches (#760). A side no Player fills
 * answers `null`, so an unbound or emptied Slot renders empty rather than failing.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputHeadToHeadResponse> => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'head-to-head');
	return await findHeadToHead(eventId, config);
});
