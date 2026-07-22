import { screenWriteModule } from '~~/server/modules/screen-write';
import { screenParamsSchema, updateScreenSchema } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const body = await readValidatedBody(event, updateScreenSchema.parse);

	return await screenWriteModule().updateScreen({
		eventId,
		screenId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
