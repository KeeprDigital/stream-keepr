import { cardService } from '~~/server/services/card';
import { requireScreenOutputRead } from '~~/server/utils/screenOutputRead';

/** The Card on this Screen, for its Card mode output (#604). */
export default defineEventHandler(async (event) => {
	const { eventId, screen } = await requireScreenOutputRead(event);
	return await cardService().getScreenCard(eventId, screen.id);
});
