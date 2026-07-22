import { screenWriteModule } from '~~/server/modules/screen-write';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	return await screenWriteModule().deleteScreen({
		eventId,
		screenId,
		originConnectionId: getOriginConnectionId(event),
	});
});
