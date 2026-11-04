import type { ScreenOutputTalentResponse } from '~~/shared/types/screenOutputReads';
import { findTalentScreen } from '~~/server/services/talentScreen';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';

/**
 * The Talents this Screen's Talent mode shows, in order (#782). A Screen naming
 * none, or only Talents since deleted, answers an empty lineup rather than failing.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputTalentResponse> => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'talent');
	return await findTalentScreen(eventId, config);
});
