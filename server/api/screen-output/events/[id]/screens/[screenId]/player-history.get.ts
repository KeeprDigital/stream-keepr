import { findPlayerMatchHistory } from '~~/server/services/playerMatchHistory';
import { requireScreenOutputModeRead, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

/** The match history of the Player this Screen's Player History mode names (#604). */
export default defineEventHandler(async (event) => {
	const { eventId, config: { playerId } } = await requireScreenOutputModeRead(event, 'player-history');
	const result = playerId
		? await findPlayerMatchHistory(eventId, playerId)
		: null;
	if (!result)
		screenOutputReadNotFound();

	return result;
});
