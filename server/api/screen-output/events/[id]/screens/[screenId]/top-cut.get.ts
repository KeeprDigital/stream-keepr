import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { findPhaseBracket } from '~~/server/services/topCutBracket';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';

/**
 * The Top Cut Bracket of the Phase this Screen's Top Cut Bracket mode names (#752),
 * derived from that Phase's Rounds and their Matches. A Screen naming no
 * Phase answers an empty bracket. Each Player's seed and Archetype are read
 * only while the Screen shows them (#759).
 */
export default defineEventHandler(async (event): Promise<ScreenOutputTopCutResponse> => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'top-cut');
	return await findPhaseBracket(eventId, config.phaseId, config);
});
