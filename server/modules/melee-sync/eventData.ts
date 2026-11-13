import { eventService } from '~~/server/services/event';
import { eventKind, isOfferedToEvent, TWO_PLAYER_MAGIC_ONLY } from '~~/shared/config/games';

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
 * Refuses to configure or run Melee Sync for an Event it is not offered to:
 * neither a One Piece Card Game Event (ADR-0057) nor a Commander Event
 * (ADR-0087) ever runs it. Checked
 * before the sync lease, so a refusal records nothing on the Event.
 */
export async function requireMeleeSyncOffered(eventId: number): Promise<void> {
	const event = await requireMeleeSyncEventData(eventId);
	if (!isOfferedToEvent(TWO_PLAYER_MAGIC_ONLY, eventKind(event))) {
		throw createError({
			statusCode: 422,
			message: 'Melee Sync is only available on a Two-Player Magic: The Gathering Event',
			data: { code: 'MELEE_SYNC_CARD_GAME_UNSUPPORTED' },
		});
	}
}
