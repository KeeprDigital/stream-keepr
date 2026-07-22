import { mapArchetypeToResponse } from '~~/server/mappers/archetype';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { archetypeService } from '~~/server/services/archetype';
import { archetypeCardService } from '~~/server/services/archetypeCard';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);

	const list = await archetypeService().findByEventId(id);

	if (list.length === 0) {
		return { archetypes: [], total: 0 };
	}

	// Fetch key cards for all archetypes in one batch query
	const archetypeIds = list.map(a => a.id);
	const keyCardsMap = await archetypeCardService().getKeyCardsByArchetypeIds(archetypeIds);

	const archetypes = list.map(archetype => ({
		...mapArchetypeToResponse(archetype),
		keyCards: (keyCardsMap.get(archetype.id) ?? []).map(c => ({
			id: c.id,
			name: c.name,
			game: c.game,
			scryfallId: c.scryfallId,
			cardType: c.cardType,
			colors: c.colors,
			cmc: c.cmc,
			manaCost: c.manaCost,
		})),
	}));

	return { archetypes, total: archetypes.length };
});
