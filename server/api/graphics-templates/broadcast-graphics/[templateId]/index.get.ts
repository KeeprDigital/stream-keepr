import {
	broadcastGraphicTemplateLibrarySummary,
	findBroadcastGraphicTemplateLibraryEntry,
} from '~~/server/modules/broadcast-graphic-template-library';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { requireUserId } from '~~/server/utils/auth';

/**
 * One library entry with the Broadcast Graphic composition it stores.
 *
 * Resolved from the library as a whole, so an entry a Template Package installed
 * reads exactly like one authored here — same shape, same identity, same route. Only
 * `authored` tells them apart, and only because what a caller may *do* with them
 * differs.
 *
 * The session is asked for as authentication and never consulted again —
 * session-scoping, not access control (ADR-0010). The document embeds Graphic
 * Asset identities, so before this guard the identifiers #172 hid from the
 * Asset Library stayed reachable one layer over (#206).
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);

	const entry = await findBroadcastGraphicTemplateLibraryEntry(event, templateId);
	if (!entry) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	return {
		...broadcastGraphicTemplateLibrarySummary(entry),
		document: entry.document,
	};
});
