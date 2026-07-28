import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { screenOutputAssetCapabilityManagerForEvent } from '~~/server/modules/screen-output-assets/runtime';
import { screenParamsSchema } from '~~/server/schemas/api/screen';

export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { id: eventId, screenId } = await getValidatedRouterParams(
		event,
		screenParamsSchema.parse,
	);
	const result = await screenOutputAssetCapabilityManagerForEvent(event).rotate({
		eventId,
		screenId,
	});
	if (result.outcome === 'missing') {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Screen not found',
		});
	}
	setResponseHeader(event, 'cache-control', 'private, no-store');
	return { assetCapability: result.capability };
});
