import type { ScreenOutputFeatureMatchDeckListResponse } from '~~/shared/types/screenOutputReads';
import { z } from 'zod';
import { featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { requireScreenOutputFeatureMatchSlot, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

const paramsSchema = z.object({
	slotId: z.coerce.number().int().positive(),
	deckListId: z.coerce.number().int().positive(),
});

/**
 * A Feature Match Deck List of the Slot this Screen shows (ADR-0057). Its
 * client names the Deck List the side it shows references now, which a swap
 * or a re-paste moves; a capability still reaches only its Screen's Slot.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputFeatureMatchDeckListResponse> => {
	const { slotId, deckListId } = await getValidatedRouterParams(event, paramsSchema.parse);
	const { eventId } = await requireScreenOutputFeatureMatchSlot(event, slotId);

	const deckList = await featureMatchDeckListService().findById(deckListId, slotId, eventId);
	if (!deckList)
		screenOutputReadNotFound();

	return {
		id: deckList.id,
		slotId: deckList.slotId,
		entries: deckList.entries,
		leaderNumber: deckList.leaderNumber,
		mainboardCount: deckList.mainboardCount,
	};
});
