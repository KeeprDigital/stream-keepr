import { archetypeWriteModule } from '~~/server/modules/archetype-write';
import { createArchetypeSchema } from '~~/server/schemas/api/archetype';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, createArchetypeSchema.parse);

	const response = await archetypeWriteModule().createArchetype({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
