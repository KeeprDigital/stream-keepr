import { commanderDeckListModule } from '~~/server/modules/feature-match-deck-list';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { commanderDeckListPreviewSchema } from '~~/server/schemas/api/featureMatchDeckList';

/** A Commander Seat's pasted Deck List as it would be saved, or the lines that refuse it (ADR-0087). */
export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const { text } = await readValidatedBody(event, commanderDeckListPreviewSchema.parse);

	return await commanderDeckListModule().preview({ eventId: id, text });
});
