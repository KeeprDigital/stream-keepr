import { broadcastDeckListService } from '~~/server/services/broadcastDeckList';
import { requireScreenOutputModeRead, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

/**
 * The complete Broadcast Deck List one Screen has selected for Deck List mode.
 *
 * There is deliberately no list id in this route. A Screen Output can read only
 * the resource its authoritative Screen configuration names, and only while its
 * Screen is in Deck List mode (ADR-0022), so its capability cannot browse the
 * Event library, ask for another Event's list, or read a list ahead of its
 * broadcast.
 */
export default defineEventHandler(async (event) => {
	const { eventId, config } = await requireScreenOutputModeRead(event, 'deck');

	const source = config.deckSource;
	if (source.type !== 'broadcast')
		screenOutputReadNotFound();

	const lists = broadcastDeckListService();
	if (!(await lists.sourceIsSelectable(source.broadcastDeckListId, eventId)))
		screenOutputReadNotFound();

	const selected = await lists.findById(source.broadcastDeckListId, eventId);
	if (!selected)
		screenOutputReadNotFound();

	return selected;
});
