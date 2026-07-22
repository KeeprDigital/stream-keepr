import { archetypeWriteModule } from '~~/server/modules/archetype-write';
import { archetypeParamsSchema, updateArchetypeSchema } from '~~/server/schemas/api/archetype';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, archetypeId } = await getValidatedRouterParams(event, archetypeParamsSchema.parse);
	const body = await readValidatedBody(event, updateArchetypeSchema.parse);

	return await archetypeWriteModule().updateArchetype({
		eventId: id,
		archetypeId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
