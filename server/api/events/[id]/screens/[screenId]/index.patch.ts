import { screenWriteModule } from '~~/server/modules/screen-write';
import { screenParamsSchema, updateScreenSchema } from '~~/server/schemas/api/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';
import { optionalBrowserSessionId } from '~~/server/utils/auth';

export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const body = await readValidatedBody(event, updateScreenSchema.parse);

	return await screenWriteModule().updateScreen({
		eventId,
		screenId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
		// The generic write can change a leased graphics Edit workspace; the module
		// decides whether this one does (#607).
		authoringSessionId: await optionalBrowserSessionId(event),
	});
});
