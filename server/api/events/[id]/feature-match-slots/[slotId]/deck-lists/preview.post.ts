import { featureMatchDeckListModule } from '~~/server/modules/feature-match-deck-list';
import { featureMatchSlotParamsSchema } from '~~/server/schemas/api/featureMatch';
import { featureMatchDeckListPreviewSchema } from '~~/server/schemas/api/featureMatchDeckList';

/** A pasted Deck List as it would be saved: resolved cards, number-only placeholders and warnings. */
export default defineEventHandler(async (event) => {
	const { id } = await getValidatedRouterParams(event, featureMatchSlotParamsSchema.parse);
	const { text } = await readValidatedBody(event, featureMatchDeckListPreviewSchema.parse);

	return await featureMatchDeckListModule().preview({ eventId: id, text });
});
