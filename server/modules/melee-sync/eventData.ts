import { eventService } from '~~/server/services/event';
import { isOfferedToCardGame, MTG_ONLY } from '~~/shared/config/games';

/**
 * Melee Sync Event data loader.
 *
 * Keeps route modules from each knowing how to load and validate the Event
 * before crossing the Melee Sync workflow seam.
 */
export async function requireMeleeSyncEventData(eventId: number) {
	const eventData = await eventService().findById(eventId);
	if (!eventData) {
		throw createError({
			statusCode: 404,
			message: 'Event not found',
		});
	}
	return eventData;
}

/**
 * Refuses to configure or run Melee Sync for an Event of a Card Game it is not
 * offered to: a One Piece Card Game Event never runs it (ADR-0057). Checked
 * before the sync lease, so a refusal records nothing on the Event.
 */
export async function requireMeleeSyncOffered(eventId: number): Promise<void> {
	const { game } = await requireMeleeSyncEventData(eventId);
	if (!isOfferedToCardGame(MTG_ONLY, game)) {
		throw createError({
			statusCode: 422,
			message: 'Melee Sync is only available on a Magic: The Gathering Event',
			data: { code: 'MELEE_SYNC_CARD_GAME_UNSUPPORTED' },
		});
	}
}
