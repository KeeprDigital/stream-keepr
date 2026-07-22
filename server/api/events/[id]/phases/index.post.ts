import { phaseWriteModule } from '~~/server/modules/phase-write';
import { eventParamsSchema } from '~~/server/schemas/api/event';
import { createPhaseSchema } from '~~/server/schemas/api/phase';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, createPhaseSchema.parse);

	const response = await phaseWriteModule().create({
		eventId: id,
		input: body,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return response;
});
