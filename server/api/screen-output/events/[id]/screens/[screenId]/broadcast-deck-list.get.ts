import type { DeckModeConfig } from '~~/shared/types/screenConfig';
import { z } from 'zod';
import { broadcastDeckListService } from '~~/server/services/broadcastDeckList';
import { screenService } from '~~/server/services/screen';
import { canReadScreenOutput } from '~~/server/utils/screenOutputAuthorization';

const paramsSchema = z.object({
	id: z.coerce.number().int().positive(),
	screenId: z.coerce.number().int().positive(),
});

function broadcastDeckListNotFound(): never {
	throw createError({
		statusCode: 404,
		statusMessage: 'Not Found',
		message: 'Broadcast Deck List not found',
	});
}

/**
 * The complete Broadcast Deck List one Screen has selected for Deck mode.
 *
 * There is deliberately no list id in this route. A Screen Output can read only
 * the resource its authoritative Screen configuration names, so its capability
 * cannot browse the Event library or ask for another Event's list.
 */
export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, paramsSchema.parse);
	const screen = await screenService().findById(screenId, eventId);
	if (!screen || !(await canReadScreenOutput(event, screen)))
		broadcastDeckListNotFound();

	const deckConfig = screen.modeConfigs?.deck as Partial<DeckModeConfig> | undefined;
	const source = deckConfig?.deckSource;
	if (source?.type !== 'broadcast')
		broadcastDeckListNotFound();

	const lists = broadcastDeckListService();
	if (!(await lists.sourceIsSelectable(source.broadcastDeckListId, eventId)))
		broadcastDeckListNotFound();

	const selected = await lists.findById(source.broadcastDeckListId, eventId);
	if (!selected)
		broadcastDeckListNotFound();

	setResponseHeader(event, 'cache-control', 'private, no-store');
	return selected;
});
