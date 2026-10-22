import { cardService } from '~~/server/services/card';
import { requireScreenOutputModeRead } from '~~/server/utils/screenOutputRead';

/** The Card on this Screen and its Card revision, for its Card mode output (#604, #734). */
export default defineEventHandler(async (event) => {
	const { eventId, screen } = await requireScreenOutputModeRead(event, 'card');
	return await cardService().getScreenCard(eventId, screen.id);
});
