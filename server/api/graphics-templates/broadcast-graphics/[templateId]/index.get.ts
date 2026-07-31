import {
	broadcastGraphicTemplateLibrarySummary,
	findBroadcastGraphicTemplateLibraryEntry,
} from '~~/server/modules/broadcast-graphic-template-library';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';

/**
 * One library entry with the Broadcast Graphic composition it stores.
 *
 * Resolved from the library as a whole, so an entry a Template Package installed
 * reads exactly like one authored here — same shape, same identity, same route. Only
 * `authored` tells them apart, and only because what a caller may *do* with them
 * differs.
 */
export default defineEventHandler(async (event) => {
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
