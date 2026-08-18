import { z } from 'zod';
import { graphicsAuthoringLeaseModule } from '~~/server/modules/graphics-authoring-lease';
import { screenEditWorkspaceLeaseRef } from '~~/server/modules/graphics-authoring-lease/screenEditWorkspace';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { requireBrowserSessionId } from '~~/server/utils/auth';

/**
 * Take, keep, or explicitly take over the Graphics Authoring Lease on this
 * Screen's graphics Edit workspace.
 *
 * One route covers acquisition, heartbeat, and takeover because an editor asks
 * the same question every time — "may I still write this?" — and the answer
 * depends on the stored lease rather than on which verb the client chose.
 * `takeover` is the one thing a client must say deliberately.
 */
const acquireSchema = z.object({
	takeover: z.boolean().optional(),
	/**
	 * The cadence the client promises to keep asking at; the lease deadline follows
	 * from it, bounded at both ends.
	 */
	heartbeatIntervalMs: z.number().int().positive().max(300_000).optional(),
}).strict();

export default defineEventHandler(async (event) => {
	const sessionId = await requireBrowserSessionId(event);
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const body = acquireSchema.parse(await readBody(event) ?? {});

	const screen = await screenService().findById(screenId, eventId);
	if (!screen)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Screen not found' });

	const acquisition = await graphicsAuthoringLeaseModule().acquire({
		...screenEditWorkspaceLeaseRef(eventId, screenId),
		sessionId,
		takeover: body.takeover,
		heartbeatIntervalMs: body.heartbeatIntervalMs,
	});

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return acquisition;
});
