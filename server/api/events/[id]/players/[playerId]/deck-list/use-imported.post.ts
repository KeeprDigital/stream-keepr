import { tcgPlusImportModule } from '~~/server/modules/tcgplus-import';
import { playerParamsSchema } from '~~/server/schemas/api/player';

/** Drops a hand edit to a Player's Deck List for the one the last TCG+ Import brought them. */
export default defineEventHandler(async (event) => {
	const { id, playerId } = await getValidatedRouterParams(event, playerParamsSchema.parse);

	return await tcgPlusImportModule().useImportedDeckList({ eventId: id, playerId });
});
