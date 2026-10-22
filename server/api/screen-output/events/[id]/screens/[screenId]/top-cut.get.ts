import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { findPhaseBracket } from '~~/server/services/topCutBracket';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';

/**
 * The Top Cut Bracket of the Phase this Screen's Top Cut mode names (#752),
 * derived from that Phase's Rounds and their Matches. A Screen naming no
 * Phase answers an empty bracket.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputTopCutResponse> => {
	const { eventId, config: { phaseId } } = await requireScreenOutputModeRead(event, 'topCut');
	return await findPhaseBracket(eventId, phaseId);
});
