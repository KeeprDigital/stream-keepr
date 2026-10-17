import { findPlayerMatchHistory } from '~~/server/services/playerMatchHistory';
import { requireScreenOutputRead, screenOutputModeConfig, screenOutputReadNotFound } from '~~/server/utils/screenOutputRead';

/** The match history of the Player this Screen's Player History mode names (#604). */
export default defineEventHandler(async (event) => {
	const { eventId, screen } = await requireScreenOutputRead(event);
	const { playerId } = screenOutputModeConfig(screen, 'player-history');
	const result = playerId ? await findPlayerMatchHistory(eventId, playerId) : null;
	if (!result)
		screenOutputReadNotFound();

	return result;
});
