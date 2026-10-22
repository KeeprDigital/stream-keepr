import type { ScreenCardWriteResult } from '~~/shared/types/card/mtg';
import { screenRuntimePublicationModule } from '~~/server/modules/screen-runtime-publication';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { cardService } from '~~/server/services/card';
import { screenService } from '~~/server/services/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event): Promise<ScreenCardWriteResult> => {
	const { id, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	const screen = await screenService().findById(screenId, id);
	if (!screen) {
		throw createError({
			statusCode: 404,
			message: 'Screen not found',
		});
	}

	const originConnectionId = getOriginConnectionId(event);
	const revision = await cardService().deleteScreenCard(id, screenId);
	await screenRuntimePublicationModule().cardCleared({
		eventId: id,
		screenId,
		revision,
		originConnectionId,
	});

	return { success: true, revision };
});
