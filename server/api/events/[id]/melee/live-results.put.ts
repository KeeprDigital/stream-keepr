import { z } from 'zod';
import { meleeSyncModule } from '~~/server/modules/melee-sync';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { getOriginConnectionId } from '~~/server/utils/ably';

const liveResultsBodySchema = z.object({
	enabled: z.boolean(),
}).strict();

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const { enabled } = await readValidatedBody(event, liveResultsBodySchema.parse);

	return await meleeSyncModule().setLiveResults({
		eventId: id,
		enabled,
		originConnectionId: getOriginConnectionId(event),
	});
});
