import type { ScreenOutputArchetypeSpotlightResponse } from '~~/shared/types/screenOutputReads';
import { projectArchetypeSpotlight } from '~~/server/modules/metagame/archetypeSpotlight';
import { readEventConversionTarget } from '~~/server/modules/metagame/conversionTarget';
import { metagameReadModel } from '~~/server/modules/metagame/readModel';
import { metagameArchetypeDetailQuerySchema } from '~~/server/schemas/api/metagame';
import { requireScreenOutputModeRead, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';
import { archetypeSpotlightScreenQuery } from '~~/shared/utils/metagameQuery';

/**
 * The Archetype this Screen's Archetype Spotlight mode names, within its scope
 * (#761): the archetype detail the app's archetype page reads for the same
 * scope and board, against the Event's Conversion Target (ADR-0061), projected
 * to what the Screen shows.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputArchetypeSpotlightResponse> => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'archetype-spotlight');
	const request = archetypeSpotlightScreenQuery(config, await readEventConversionTarget(eventId));
	const detail = request
		? await metagameReadModel().getArchetypeDetail(eventId, {
				...metagameArchetypeDetailQuerySchema.parse(request.query),
				archetypeId: request.archetypeId,
			})
		: null;
	if (!detail)
		screenOutputReadNotFound();

	return projectArchetypeSpotlight(detail, { cardLimit: config.cardLimit, excludedCardTypes: config.excludedCardTypes });
});
