import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';
import { requireUserId } from '~~/server/utils/auth';
import { refuseInstalledBroadcastGraphicTemplateWrite } from '~~/server/utils/broadcastGraphicTemplateWrites';

/**
 * Remove one Broadcast Graphic Template from the library.
 *
 * Copies placed from it are untouched: they are independent Broadcast Graphics on
 * their Screens, with their own Graphic Inputs, their own Graphic Asset References,
 * and no link to the design they were initialised from. Deleting a template can
 * therefore never blank a Screen or a live show.
 *
 * A design a Template Package installed is refused rather than silently reported as
 * missing: it is visible in the library, so "not found" would be a lie about
 * something the author is looking straight at.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	const removed = await broadcastGraphicTemplateService().remove(templateId);
	if (!removed) {
		await refuseInstalledBroadcastGraphicTemplateWrite(event, templateId, 'deleted');
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	setResponseStatus(event, 204);
	return null;
});
