import { archetypeWriteModule } from '~~/server/modules/archetype-write';
import { archetypeParamsSchema, mergeArchetypeSchema } from '~~/server/schemas/api/archetype';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** Merges the Archetype in the path into another of its Event, which keeps its own name, colours, key cards and pin. */
export default defineEventHandler(async (event) => {
	const { id, archetypeId } = await getValidatedRouterParams(event, archetypeParamsSchema.parse);
	const { intoArchetypeId } = await readValidatedBody(event, mergeArchetypeSchema.parse);

	return await archetypeWriteModule().mergeArchetype({
		eventId: id,
		archetypeId,
		intoArchetypeId,
		originConnectionId: getOriginConnectionId(event),
	});
});
