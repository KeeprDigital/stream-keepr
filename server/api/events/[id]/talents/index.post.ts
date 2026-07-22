import { talentWriteModule } from '~~/server/modules/talent-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createTalentSchema } from '~~/server/schemas/api/talent';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id: eventId } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, createTalentSchema.parse);

	const response = await talentWriteModule().createTalent({
		eventId,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
