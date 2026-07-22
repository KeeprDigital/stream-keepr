import { archetypeWriteModule } from '~~/server/modules/archetype-write';
import { archetypeParamsSchema } from '~~/server/schemas/api/archetype';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, archetypeId } = await getValidatedRouterParams(event, archetypeParamsSchema.parse);

	return await archetypeWriteModule().deleteArchetype({
		eventId: id,
		archetypeId,
		originConnectionId: getOriginConnectionId(event),
	});
});
