import { optionalGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicsAuthoringLeaseModule } from '~~/server/modules/graphics-authoring-lease';
import { screenEditWorkspaceLeaseRef } from '~~/server/modules/graphics-authoring-lease/screenEditWorkspace';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';

/** What the asking session may currently do with this Screen's graphics Edit workspace. */
export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	const screen = await screenService().findById(screenId, eventId);
	if (!screen)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Screen not found' });

	const lease = await graphicsAuthoringLeaseModule().describe(
		screenEditWorkspaceLeaseRef(eventId, screenId),
		await optionalGraphicsAuthorSession(event),
	);

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return { lease };
});
