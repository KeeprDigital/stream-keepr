import { z } from 'zod';
import { meleeSyncModule } from '~~/server/modules/melee-sync';
import { eventParamsSchema } from '~~/server/schemas/api/event';

const updateFromMeleeBodySchema = z.object({
	includeDeckLists: z.boolean().optional(),
	advanceRound: z.boolean().optional(),
}).default({});

export default defineEventHandler(async (event) => {
	const params = await getValidatedRouterParams(event, eventParamsSchema.parse);
	const eventId = params.id;
	const body = await readValidatedBody(event, updateFromMeleeBodySchema.parse);

	return await meleeSyncModule().updateFromMelee(event, eventId, {
		includeDeckLists: body?.includeDeckLists,
		advanceRound: body?.advanceRound,
	});
});
