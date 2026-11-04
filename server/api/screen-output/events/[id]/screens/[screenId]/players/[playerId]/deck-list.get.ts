import type { ScreenOutputOpPlayerDeckListResponse } from '~~/shared/types/screenOutputReads';
import { z } from 'zod';
import { mapPlayerToResponse } from '~~/server/mappers/player';
import { eventService } from '~~/server/services/event';
import { opPlayerDeckListService } from '~~/server/services/opPlayerDeckList';
import { playerService } from '~~/server/services/player';
import { requireScreenOutputRead, screenOutputPublishedPlayerIds, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

const paramsSchema = z.object({
	playerId: z.coerce.number().int().positive(),
});

/**
 * A One Piece Card Game Player a Deck List Screen shows, with their Deck List
 * (ADR-0074). A capability reaches only the Player its Screen's Deck Source
 * selects, so it cannot read the Event's Deck Lists ahead of their broadcast.
 */
export default defineEventHandler(async (event): Promise<ScreenOutputOpPlayerDeckListResponse> => {
	const { playerId } = await getValidatedRouterParams(event, paramsSchema.parse);
	const { eventId, screen, reader } = await requireScreenOutputRead(event);
	if (reader === 'capability' && !(await screenOutputPublishedPlayerIds(screen, eventId)).includes(playerId))
		screenOutputReadNotFound();

	const [player, eventRow] = await Promise.all([
		playerService().findById(playerId, eventId),
		eventService().findById(eventId),
	]);
	if (!player || eventRow?.game !== 'op')
		screenOutputReadNotFound();

	const deckList = await opPlayerDeckListService().findByPlayer(eventId, playerId);
	return {
		player: mapPlayerToResponse(player),
		deckList: deckList && {
			id: deckList.id,
			playerId: deckList.playerId,
			entries: deckList.entries,
			leaderNumber: deckList.leaderNumber,
			mainboardCount: deckList.mainboardCount,
		},
	};
});
