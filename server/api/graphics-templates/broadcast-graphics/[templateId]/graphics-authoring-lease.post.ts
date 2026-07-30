import { z } from 'zod';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicsAuthoringLeaseModule } from '~~/server/modules/graphics-authoring-lease';
import { graphicsTemplateLeaseRef } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';

/**
 * Take, keep, or explicitly take over the Graphics Authoring Lease on one
 * Broadcast Graphic Template.
 *
 * The same one-route shape the Screen Edit workspace uses, for the same reason: an
 * editor asks the same question every time — may I still write this? — and the
 * answer depends on the stored lease rather than on which verb the client chose.
 * The client composable is reused unchanged; it takes an endpoint, not a Screen.
 */
const acquireSchema = z.object({
	takeover: z.boolean().optional(),
	heartbeatIntervalMs: z.number().int().positive().max(300_000).optional(),
}).strict();

export default defineEventHandler(async (event) => {
	const sessionId = await requireGraphicsAuthorSession(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);
	const body = acquireSchema.parse(await readBody(event) ?? {});

	// A lease on an artifact that does not exist would be a claim nobody could ever
	// release or discover.
	const template = await broadcastGraphicTemplateService().findById(templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	const acquisition = await graphicsAuthoringLeaseModule().acquire({
		...graphicsTemplateLeaseRef(templateId),
		sessionId,
		takeover: body.takeover,
		heartbeatIntervalMs: body.heartbeatIntervalMs,
	});

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return acquisition;
});
