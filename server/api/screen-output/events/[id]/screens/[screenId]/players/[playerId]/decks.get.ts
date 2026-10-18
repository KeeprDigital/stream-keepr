import type { ScreenOutputPlayerDecksResponse } from '~~/shared/types/screenOutputReads';
import { z } from 'zod';
import { mapPlayerToResponse } from '~~/server/mappers/player';
import { eventService } from '~~/server/services/event';
import { playerService } from '~~/server/services/player';
import { playerDeckCardService } from '~~/server/services/playerDeckCard';
import { requireScreenOutputRead, screenOutputPublishedPlayerIds, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

const paramsSchema = z.object({
	playerId: z.coerce.number().int().positive(),
});

const querySchema = z.object({
	deckId: z.coerce.number().int().positive().optional(),
});

/**
 * A Player this Screen renders, with their decks (#604): the Deck mode's
 * selected Player, or a side of the Feature Match Slot the Screen shows.
 *
 * A capability reaches no other Player, so it cannot read the Event's
 * decklists ahead of their broadcast.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputPlayerDecksResponse> => {
	const { playerId } = await getValidatedRouterParams(event, paramsSchema.parse);
	const selection = await getValidatedQuery(event, querySchema.parse);
	const { eventId, screen, reader } = await requireScreenOutputRead(event);
	if (reader === 'capability' && !(await screenOutputPublishedPlayerIds(screen, eventId)).includes(playerId))
		screenOutputReadNotFound();

	const [player, eventRow] = await Promise.all([
		playerService().findById(playerId, eventId),
		eventService().findById(eventId),
	]);
	if (!player || !eventRow)
		screenOutputReadNotFound();

	return {
		player: mapPlayerToResponse(player),
		decks: await playerDeckCardService().getPlayerDecks(eventId, playerId, eventRow.pointsSystem ?? null, selection),
	};
});
