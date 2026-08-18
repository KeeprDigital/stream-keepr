import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import { featureMatchLayoutTemplateParamsSchema } from '~~/server/schemas/api/featureMatchLayoutTemplate';
import { featureMatchLayoutTemplateService } from '~~/server/services/featureMatchLayoutTemplate';
import { requireUserId } from '~~/server/utils/auth';
import { refuseInstalledFeatureMatchLayoutTemplateWrite } from '~~/server/utils/featureMatchLayoutTemplateWrites';

/**
 * Remove one Feature Match Layout Template from the library.
 *
 * Layouts placed from it are untouched: a placed layout is an independent copy in
 * its Screen's own configuration, with its own Graphic Asset References and no link
 * to the design it came from. Deleting a template can never blank a Screen or a live
 * show.
 *
 * A layout a Template Package installed is refused rather than reported as missing:
 * it is visible in the library, so "not found" would be a lie about something the
 * author is looking straight at.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, featureMatchLayoutTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	const removed = await featureMatchLayoutTemplateService().remove(templateId);
	if (!removed) {
		await refuseInstalledFeatureMatchLayoutTemplateWrite(event, templateId, 'deleted');
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Feature Match Layout Template not found',
		});
	}

	setResponseStatus(event, 204);
	return null;
});
