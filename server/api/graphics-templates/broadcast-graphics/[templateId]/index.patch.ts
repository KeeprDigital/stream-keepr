import { mapBroadcastGraphicTemplateToResponse } from '~~/server/mappers/broadcastGraphicTemplate';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import {
	broadcastGraphicTemplateParamsSchema,
	updateBroadcastGraphicTemplateSchema,
} from '~~/server/schemas/api/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

/**
 * Revise one Broadcast Graphic Template.
 *
 * Every accepted change — name, description, or composition — advances the
 * automatically managed revision by one under the same stable identity. The write
 * is admitted by the template's own Graphics Authoring Lease, so a second session
 * with the library open observes the revision instead of overwriting it.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	const body = updateBroadcastGraphicTemplateSchema.parse(
		await readJsonPayloadLimited(event, 512 * 1024, 'Broadcast Graphic Template'),
	);

	const template = await broadcastGraphicTemplateService().update(templateId, body);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	return mapBroadcastGraphicTemplateToResponse(template);
});
