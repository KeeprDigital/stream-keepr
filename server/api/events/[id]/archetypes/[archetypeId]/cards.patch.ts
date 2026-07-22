import { archetypeWriteModule } from '~~/server/modules/archetype-write';
import { archetypeParamsSchema, setArchetypeKeyCardsSchema } from '~~/server/schemas/api/archetype';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, archetypeId } = await getValidatedRouterParams(event, archetypeParamsSchema.parse);
	const body = await readValidatedBody(event, setArchetypeKeyCardsSchema.parse);

	return await archetypeWriteModule().updateCards({
		eventId: id,
		archetypeId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
