import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';

/**
 * Remove one Broadcast Graphic Template from the library.
 *
 * Copies placed from it are untouched: they are independent Broadcast Graphics on
 * their Screens, with their own Graphic Inputs, their own Graphic Asset References,
 * and no link to the design they were initialised from. Deleting a template can
 * therefore never blank a Screen or a live show.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	const removed = await broadcastGraphicTemplateService().remove(templateId);
	if (!removed) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	setResponseStatus(event, 204);
	return null;
});
