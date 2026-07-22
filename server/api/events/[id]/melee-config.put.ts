import { meleeSyncModule } from '~~/server/modules/melee-sync';
import { eventParamsSchema, meleeConfigUpdateSchema } from '~~/server/schemas/api/event';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	// meleeConfigUpdateSchema: meleeClientSecret is optional — omitting it preserves the stored secret.
	const body = await readValidatedBody(event, meleeConfigUpdateSchema.parse);

	return await meleeSyncModule().updateConfiguration({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});
});
