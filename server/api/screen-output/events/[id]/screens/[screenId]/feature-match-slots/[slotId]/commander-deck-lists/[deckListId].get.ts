import type { ScreenOutputCommanderDeckListResponse } from '~~/shared/types/screenOutputReads';
import { z } from 'zod';
import { featureMatchDeckListService } from '~~/server/services/featureMatchDeckList';
import { requireScreenOutputFeatureMatchSlot, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

const paramsSchema = z.object({
	slotId: z.coerce.number().int().positive(),
	deckListId: z.coerce.number().int().positive(),
});

/**
 * A Commander Seat's Feature Match Deck List of the Slot this Screen shows
 * (ADR-0087). Its client names the Deck List the Seat it shows references now,
 * which Swap Seats or a re-paste moves; a capability still reaches only its
 * Screen's Slot.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputCommanderDeckListResponse> => {
	const { slotId, deckListId } = await getValidatedRouterParams(event, paramsSchema.parse);
	const { eventId } = await requireScreenOutputFeatureMatchSlot(event, slotId);

	const deckList = await featureMatchDeckListService().findCommanderById(deckListId, slotId, eventId);
	if (!deckList)
		screenOutputReadNotFound();

	return {
		id: deckList.id,
		slotId: deckList.slotId,
		entries: deckList.entries,
	};
});
