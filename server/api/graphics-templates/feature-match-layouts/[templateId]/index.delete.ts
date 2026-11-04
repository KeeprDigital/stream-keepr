import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import { featureMatchLayoutTemplateParamsSchema } from '~~/server/schemas/api/featureMatchLayoutTemplate';
import { featureMatchLayoutTemplateService } from '~~/server/services/featureMatchLayoutTemplate';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Remove one Feature Match Layout Template from the library.
 *
 * Layouts placed from it are untouched: a placed layout is an independent copy in
 * its Screen's own configuration, with its own Graphic Asset References and no link
 * to the design it came from. Deleting a template can never blank a Screen or a live
 * show.
 *
 * A layout a Template Package installed is removed through the Graphics Asset
 * Library, which owns its record: its references are released with it, and
 * retrying the installation that published it reinstalls it (ADR-0068).
 */
export default defineEventHandler(async (event) => {
	const userId = await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, featureMatchLayoutTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	if (!await featureMatchLayoutTemplateService().remove(templateId)) {
		const installed = await graphicsAssetLibraryForEvent(event).removeInstalledGraphicsTemplate({
			templateId,
			kind: 'feature-match-layout',
			removedBy: userId,
		}).catch(error => rethrowGraphicsAssetApiError(error, event));
		if (installed.outcome === 'not-found') {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Feature Match Layout Template not found',
			});
		}
	}

	setResponseStatus(event, 204);
	return null;
});
