import type { OpUnresolvedDeckCardAnswer } from '~~/shared/types/opUnresolvedDeckCard';
import { opUnresolvedDeckCardModule } from '~~/server/modules/op-unresolved-deck-card';
import { opCardParamsSchema } from '~~/server/schemas/api/opCard';

/** Looks an Unresolved Deck Card up again; a card bandai-keepr now knows resolves every Deck List holding it. */
export default defineEventHandler(async (event): Promise<OpUnresolvedDeckCardAnswer> => {
	const { id, number } = await getValidatedRouterParams(event, opCardParamsSchema.parse);
	return await opUnresolvedDeckCardModule().retry({ eventId: id, number });
});
