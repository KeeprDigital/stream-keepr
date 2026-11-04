import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Remove one Broadcast Graphic Template from the library.
 *
 * Copies placed from it are untouched: they are independent Broadcast Graphics on
 * their Screens, with their own Graphic Inputs, their own Graphic Asset References,
 * and no link to the design they were initialised from. Deleting a template can
 * therefore never blank a Screen or a live show.
 *
 * A design a Template Package installed is removed through the Graphics Asset
 * Library, which owns its record: its references are released with it, and
 * retrying the installation that published it reinstalls it (ADR-0068).
 */
export default defineEventHandler(async (event) => {
	const userId = await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	if (!await broadcastGraphicTemplateService().remove(templateId)) {
		const installed = await graphicsAssetLibraryForEvent(event).removeInstalledGraphicsTemplate({
			templateId,
			kind: 'broadcast-graphic',
			removedBy: userId,
		}).catch(error => rethrowGraphicsAssetApiError(error, event));
		if (installed.outcome === 'not-found') {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Broadcast Graphic Template not found',
			});
		}
	}

	setResponseStatus(event, 204);
	return null;
});
