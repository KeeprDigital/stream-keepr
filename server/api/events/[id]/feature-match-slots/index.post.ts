import { featureMatchSlotWriteModule } from '~~/server/modules/feature-match-slot-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createFeatureMatchSchema } from '~~/server/schemas/api/featureMatch';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, createFeatureMatchSchema.parse);

	const response = await featureMatchSlotWriteModule().create({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
