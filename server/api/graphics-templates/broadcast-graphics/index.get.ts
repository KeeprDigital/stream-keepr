import {
	broadcastGraphicTemplateLibrarySummary,
	listBroadcastGraphicTemplateLibrary,
} from '~~/server/modules/broadcast-graphic-template-library';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';

/**
 * Browse the installation's Broadcast Graphic Template library.
 *
 * Deliberately not under an Event. The library is installation-scoped, so the same
 * listing is the same listing from every Event's Edit workspace — which is what
 * "browsable across Events" means in practice, rather than an aggregation someone
 * has to build per Event.
 *
 * Designs authored here and designs a Template Package installed appear in one list,
 * because "what can I place" is one question. Where an entry came from is a property
 * of the entry rather than a reason to look somewhere else for it.
 *
 * The session is session-scoping, not access control (ADR-0008, #206).
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const entries = await listBroadcastGraphicTemplateLibrary(event);

	return { templates: entries.map(broadcastGraphicTemplateLibrarySummary) };
});
