import { commanderDeckListModule } from '~~/server/modules/feature-match-deck-list';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { saveCommanderDeckListSchema } from '~~/server/schemas/api/featureMatchDeckList';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** Saves a pasted Deck List to a Commander Seat with the Commanders confirmed, replacing the one it held (ADR-0087). */
export default defineEventHandler(async (event) => {
	const { id, slotId } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const { seat, text, commanders } = await readValidatedBody(event, saveCommanderDeckListSchema.parse);

	return await commanderDeckListModule().save({
		eventId: id,
		slotId,
		seat,
		text,
		commanders,
		originConnectionId: getOriginConnectionId(event),
	});
});
