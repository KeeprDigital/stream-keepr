import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameCardsQuerySchema } from '~~/server/schemas/api/metagame';
import { requireScreenOutputRead, screenOutputModeConfig } from '~~/server/utils/screenOutputRead';
import { topCardsScreenQuery } from '~~/shared/utils/metagameQuery';

/** The card breakdown this Screen's Top Cards mode renders, derived from its saved configuration (#604). */
export default defineEventHandler(async (event) => {
	const { eventId, screen } = await requireScreenOutputRead(event);
	const query = metagameCardsQuerySchema.parse(topCardsScreenQuery(screenOutputModeConfig(screen, 'top-cards')));

	return await metagameReadModel().getCardBreakdown(eventId, query);
});
