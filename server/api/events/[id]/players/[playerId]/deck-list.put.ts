import { opDeckListWriteModule } from '~~/server/modules/op-deck-list-write';
import { writeOpPlayerDeckListSchema } from '~~/server/schemas/api/opDeckList';
import { playerParamsSchema } from '~~/server/schemas/api/player';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** Writes a One Piece Card Game Player's Deck List by hand, replacing the one they held. Warnings never refuse it. */
export default defineEventHandler(async (event) => {
	const { id, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);
	const input = await readValidatedBody(event, writeOpPlayerDeckListSchema.parse);

	return await opDeckListWriteModule().write({
		eventId: id,
		owner: { kind: 'player', playerId },
		input,
		source: 'hand',
		originConnectionId: getOriginConnectionId(event),
	});
});
