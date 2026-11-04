import { opDeckListWriteModule } from '~~/server/modules/op-deck-list-write';
import { playerParamsSchema } from '~~/server/schemas/api/player';

/** A One Piece Card Game Player's Deck List, or `null` for a Player with none. */
export default defineEventHandler(async (event) => {
	const { id, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);

	return { deckList: await opDeckListWriteModule().readPlayer({ eventId: id, playerId }) };
});
