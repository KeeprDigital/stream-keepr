import type { OpUnresolvedDeckCard } from '~~/shared/types/opUnresolvedDeckCard';
import { opUnresolvedDeckCardModule } from '~~/server/modules/op-unresolved-deck-card';
import { eventParamsSchema } from '~~/server/schemas/api/event';

/** A One Piece Card Game Event's Unresolved Deck Cards, with the Deck Lists holding each (ADR-0074). */
export default defineEventHandler(async (event): Promise<OpUnresolvedDeckCard[]> => {
	const { id } = await getValidatedRouterParams(event, eventParamsSchema.parse);
	return await opUnresolvedDeckCardModule().list({ eventId: id });
});
