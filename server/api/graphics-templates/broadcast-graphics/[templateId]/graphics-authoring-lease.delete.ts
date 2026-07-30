import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicsAuthoringLeaseModule } from '~~/server/modules/graphics-authoring-lease';
import { graphicsTemplateLeaseRef } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';

/**
 * Give up this session's lease on one Broadcast Graphic Template, so a departing
 * author frees it immediately instead of leaving it to expire.
 */
export default defineEventHandler(async (event) => {
	const sessionId = await requireGraphicsAuthorSession(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);

	const lease = await graphicsAuthoringLeaseModule().release(
		graphicsTemplateLeaseRef(templateId),
		sessionId,
	);

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return { lease };
});
