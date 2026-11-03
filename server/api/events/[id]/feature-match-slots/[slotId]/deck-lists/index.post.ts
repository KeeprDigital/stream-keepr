import { featureMatchDeckListModule } from '~~/server/modules/feature-match-deck-list';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { saveFeatureMatchDeckListSchema } from '~~/server/schemas/api/featureMatchDeckList';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** Saves a pasted Deck List to a Slot side, replacing the one it held. Warnings never refuse it. */
export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const { side, text } = await readValidatedBody(event, saveFeatureMatchDeckListSchema.parse);

	return await featureMatchDeckListModule().save({
		eventId: id,
		slotId,
		side,
		text,
		originConnectionId: getOriginConnectionId(event),
	});
});
