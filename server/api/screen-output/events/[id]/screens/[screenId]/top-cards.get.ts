import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameCardsQuerySchema } from '~~/server/schemas/api/metagame';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';
import { topCardsScreenQuery } from '~~/shared/utils/metagameQuery';

/** The card breakdown this Screen's Most Played Cards mode renders, derived from its saved configuration (#604). */
export default defineEventHandler(async (event) => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'top-cards');
	const query = metagameCardsQuerySchema.parse(topCardsScreenQuery(config));

	return await metagameReadModel().getCardBreakdown(eventId, query);
});
