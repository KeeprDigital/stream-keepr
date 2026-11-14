import { commanderDeckListModule } from '~~/server/modules/feature-match-deck-list';
import { featureMatchDeckListParamsSchema } from '~~/server/schemas/api/featureMatchDeckList';

/** A Commander Seat's saved Feature Match Deck List of this Slot, with its cards (ADR-0087). */
export default defineEventHandler(async (event) => {
	const { id, slotId, deckListId } = await getValidatedRouterParams(event, featureMatchDeckListParamsSchema.parse);

	return await commanderDeckListModule().read({ eventId: id, slotId, deckListId });
});
