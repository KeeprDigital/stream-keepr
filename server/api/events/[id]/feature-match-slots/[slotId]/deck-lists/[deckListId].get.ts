import { featureMatchDeckListModule } from '~~/server/modules/feature-match-deck-list';
import { featureMatchDeckListParamsSchema } from '~~/server/schemas/api/featureMatchDeckList';

/** A saved Feature Match Deck List of this Slot, with its entries and warnings. */
export default defineEventHandler(async (event) => {
	const { id, slotId, deckListId } = await getValidatedRouterParams(event, featureMatchDeckListParamsSchema.parse);

	return await featureMatchDeckListModule().read({ eventId: id, slotId, deckListId });
});
