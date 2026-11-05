import type { ScreenOutputTopCutResponse } from '~~/shared/types/screenOutputReads';
import { eventService } from '~~/server/services/event';
import { findTopCutBracket } from '~~/server/services/topCutBracket';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';

/**
 * The Top Cut Bracket this Screen's Top Cut Bracket mode shows: the bracket of
 * the Phase it names (#752), derived from that Phase's Rounds and their
 * Matches, or its Manual Bracket (ADR-0075), which a One Piece Card Game Event
 * always shows. A Screen naming no Phase answers an empty bracket. Seeds place
 * a Phase's bracket and size its byes, at the Screen's bracket size if set
 * (#906); each Player's seed and Archetype are carried only while the Screen
 * shows them (#759).
 */
export default defineEventHandler(async (event): Promise<ScreenOutputTopCutResponse> => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'top-cut');
	const found = await eventService().findById(eventId);
	return await findTopCutBracket(eventId, found?.game, config);
});
