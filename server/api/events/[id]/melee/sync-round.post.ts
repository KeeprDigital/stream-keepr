import { z } from 'zod';
import { meleeSyncModule } from '~~/server/modules/melee-sync';
import { eventParamsSchema } from '~~/server/schemas/api/event';

const syncRoundBodySchema = z.object({
	roundId: z.coerce.number().int().positive(),
});

export default defineEventHandler(async (event) => {
	const params = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const body = await readValidatedBody(event, syncRoundBodySchema.parse);
	const eventId = params.id;

	return await meleeSyncModule().syncRoundMatches(event, eventId, body.roundId);
});
