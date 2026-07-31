import { mapGraphicStyleSetToSummary } from '~~/server/mappers/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';

/**
 * Browse the installation's Graphic Style Sets.
 *
 * Not under an Event, for the same reason the Broadcast Graphic Template library is
 * not: Events consume Style Sets through templates and never own them, so the same
 * listing is the same listing from every Event's Edit workspace.
 */
export default defineEventHandler(async () => {
	const styleSets = await graphicStyleSetService().findAll();

	return { styleSets: styleSets.map(mapGraphicStyleSetToSummary) };
});
