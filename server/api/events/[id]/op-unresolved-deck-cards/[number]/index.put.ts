import type { OpUnresolvedDeckCardAnswer } from '~~/shared/types/opUnresolvedDeckCard';
import { opUnresolvedDeckCardModule } from '~~/server/modules/op-unresolved-deck-card';
import { opCardParamsSchema } from '~~/server/schemas/api/opCard';
import { resolveOpUnresolvedDeckCardSchema } from '~~/server/schemas/api/opDeckList';

/** Resolves an Unresolved Deck Card to a picked card in every Deck List in the Event holding it. */
export default defineEventHandler(async (event): Promise<OpUnresolvedDeckCardAnswer> => {
	const { id, number } = await getValidatedRouterParams(event, opCardParamsSchema.parse);
	const { cardNumber } = await readValidatedBody(event, resolveOpUnresolvedDeckCardSchema.parse);
	return await opUnresolvedDeckCardModule().resolve({ eventId: id, number, cardNumber });
});
