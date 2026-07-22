import { screenRuntimePublicationModule } from '~~/server/modules/screen-runtime-publication';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { cardInputSchema } from '~~/server/schemas/kv/card';
import { cardService } from '~~/server/services/card';
import { screenService } from '~~/server/services/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const body = await readValidatedBody(event, cardInputSchema.parse);

	const screen = await screenService().findById(screenId, id);
	if (!screen) {
		throw createError({
			statusCode: 404,
			message: 'Screen not found',
		});
	}

	const originConnectionId = getOriginConnectionId(event);
	await cardService().setScreenCard(id, screenId, body, originConnectionId);
	await screenRuntimePublicationModule().cardUpdated({
		eventId: id,
		screenId,
		card: body,
		originConnectionId,
	});

	return { success: true };
});
