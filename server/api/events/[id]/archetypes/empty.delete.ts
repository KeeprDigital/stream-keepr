import { archetypeWriteModule } from '~~/server/modules/archetype-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** Removes the Event's Empty Archetypes, answering the ids it removed. */
export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	return await archetypeWriteModule().removeEmptyArchetypes({
		eventId: id,
		originConnectionId: getOriginConnectionId(event),
	});
});
