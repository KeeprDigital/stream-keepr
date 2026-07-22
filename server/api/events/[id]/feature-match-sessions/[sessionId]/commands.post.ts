import { featureMatchSessionModule } from '~~/server/modules/feature-match-session';
import { featureMatchCommandSchema, featureMatchSessionParamsSchema } from '~~/server/schemas/api/featureMatch';
import { getOriginConnectionId } from '~~/server/utils/ably';

export default defineEventHandler(async (event) => {
	const { id, sessionId } = await getValidatedRouterParams(event, featureMatchSessionParamsSchema.parse);
	const body = await readValidatedBody(event, featureMatchCommandSchema.parse);
	const originConnectionId = getOriginConnectionId(event);

	return await featureMatchSessionModule().applyCommand(sessionId, id, body, originConnectionId);
});
