import { mapGraphicStyleSetToSummary } from '~~/server/mappers/graphicStyleSet';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';

/**
 * Browse the installation's Graphic Style Sets.
 *
 * Not under an Event, for the same reason the Broadcast Graphic Template library is
 * not: Events consume Style Sets through templates and never own them, so the same
 * listing is the same listing from every Event's Edit workspace.
 *
 * The session is asked for as authentication and never consulted again —
 * session-scoping like every sibling author-facing route, not access control
 * (ADR-0008, #206).
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const styleSets = await graphicStyleSetService().findAll();

	return { styleSets: styleSets.map(mapGraphicStyleSetToSummary) };
});
