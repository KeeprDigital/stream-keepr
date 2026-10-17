import type { ScreenOutputMetagameResponse } from '~~/shared/types/screenOutputReads';
import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameArchetypesQuerySchema, metagameCardsQuerySchema } from '~~/server/schemas/api/metagame';
import { requireScreenOutputRead, screenOutputModeConfig } from '~~/server/utils/screenOutputRead';
import { metagameScreenQuery } from '~~/shared/utils/metagameQuery';

/** The breakdown this Screen's Metagame mode renders, derived from its saved configuration (#604). */
export default defineEventHandler(async (event): Promise<ScreenOutputMetagameResponse> => {
	const { eventId, screen } = await requireScreenOutputRead(event);
	const request = metagameScreenQuery(screenOutputModeConfig(screen, 'metagame'));
	const readModel = metagameReadModel();

	return request.viewMode === 'cards'
		? { viewMode: 'cards', breakdown: await readModel.getCardBreakdown(eventId, metagameCardsQuerySchema.parse(request.query)) }
		: { viewMode: 'archetype', breakdown: await readModel.getArchetypeBreakdown(eventId, metagameArchetypesQuerySchema.parse(request.query)) };
});
