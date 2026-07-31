import { mapBroadcastGraphicTemplateToSummary } from '~~/server/mappers/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';

/**
 * Browse the installation's Broadcast Graphic Template library.
 *
 * Deliberately not under an Event. The library is installation-scoped, so the same
 * listing is the same listing from every Event's Edit workspace — which is what
 * "browsable across Events" means in practice, rather than an aggregation someone
 * has to build per Event.
 */
export default defineEventHandler(async () => {
	const templates = await broadcastGraphicTemplateService().findAll();

	return { templates: templates.map(mapBroadcastGraphicTemplateToSummary) };
});
