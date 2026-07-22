import { archetypeParamsSchema } from '~~/server/schemas/api/archetype';
import { archetypeService } from '~~/server/services/archetype';
import { archetypeCardService } from '~~/server/services/archetypeCard';

export default defineEventHandler(async (event) => {
	const { id: eventId, archetypeId } = await getValidatedRouterParams(event, archetypeParamsSchema.parse);

	// Verify archetype belongs to this event
	const archetype = await archetypeService().findById(archetypeId, eventId);
	if (!archetype) {
		throw createError({ statusCode: 404, statusMessage: 'Archetype not found' });
	}

	const keyCards = await archetypeCardService().getKeyCards(archetypeId);
	return { keyCards };
});
