import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicsAuthoringLeaseModule } from '~~/server/modules/graphics-authoring-lease';
import { screenEditWorkspaceLeaseRef } from '~~/server/modules/graphics-authoring-lease/screenEditWorkspace';
import { screenParamsSchema } from '~~/server/schemas/api/screen';

/**
 * Give up this session's lease on the Screen's graphics Edit workspace, so a
 * departing author frees the artifact immediately instead of leaving it to expire.
 */
export default defineEventHandler(async (event) => {
	const sessionId = await requireGraphicsAuthorSession(event);
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	const lease = await graphicsAuthoringLeaseModule().release(
		screenEditWorkspaceLeaseRef(eventId, screenId),
		sessionId,
	);

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return { lease };
});
