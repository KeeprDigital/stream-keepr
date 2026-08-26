import type { UpdateEventInput } from '~~/server/schemas/api/event';
import type { EventResponse } from '~~/shared/api';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { cardService } from '~~/server/services/card';
import { eventService } from '~~/server/services/event';
import { featureMatchService } from '~~/server/services/featureMatch';
import { screenService } from '~~/server/services/screen';
import { BroadcastDeckListsInUseError } from '~~/server/utils/errors';
import { requireTalentInEvent } from '~~/server/utils/routeGuards';
import { BROADCAST_DECK_LISTS_IN_USE } from '~~/shared/types/broadcastDeckList';

interface UpdateEventParams {
	eventId: number;
	input: UpdateEventInput;
	originConnectionId?: string;
}

interface DeleteEventParams {
	eventId: number;
	originConnectionId?: string;
}

export function eventWriteModule() {
	const publication = eventDataPublicationModule();
	const events = eventService();

	async function updateEvent({ eventId, input, originConnectionId }: UpdateEventParams): Promise<EventResponse> {
		if (input.broadcastDeckListsEnabled === true) {
			const current = await events.findById(eventId);
			if (!current) {
				throw createError({
					statusCode: 404,
					message: 'Event not found',
				});
			}
			if (current.game !== 'mtg') {
				throw createError({
					statusCode: 400,
					message: 'Broadcast Deck Lists can only be enabled for MTG Events',
				});
			}
		}

		await Promise.all([
			requireTalentInEvent(eventId, input.commentator1TalentId),
			requireTalentInEvent(eventId, input.commentator2TalentId),
		]);

		let updatedEvent;
		try {
			updatedEvent = await events.update(eventId, input);
		}
		catch (error) {
			if (error instanceof BroadcastDeckListsInUseError) {
				const names = error.screens.map(screen => screen.name).join(', ');
				throw createError({
					statusCode: 409,
					message: `Broadcast Deck Lists cannot be disabled while selected by ${error.screens.length === 1 ? 'Screen' : 'Screens'}: ${names}`,
					data: { code: BROADCAST_DECK_LISTS_IN_USE, screens: error.screens },
				});
			}
			throw error;
		}

		if (!updatedEvent) {
			throw createError({
				statusCode: 404,
				message: 'Event not found',
			});
		}

		if (input.numFeatureMatches !== undefined)
			await featureMatchService().syncFeatureMatches(eventId, updatedEvent.numFeatureMatches);

		return await publication.eventUpdated({
			eventId,
			entity: updatedEvent,
			originConnectionId,
		});
	}

	async function deleteEvent({ eventId, originConnectionId }: DeleteEventParams): Promise<{ success: boolean }> {
		// Capture derived-artifact identities before the relational cascade.
		const screens = await screenService().findIdsByEventId(eventId);

		const result = await events.remove(eventId);

		if (!result) {
			throw createError({
				statusCode: 404,
				message: 'Event not found',
			});
		}

		const cardSvc = cardService();
		// Keep external cleanup bounded. An Event may contain many Screens and an
		// unbounded Promise.all would fan out two remote operations per Screen.
		for (const screen of screens)
			await cardSvc.cleanupDeletedScreenCard(eventId, screen.id);

		await publication.eventDeleted({
			eventId,
			originConnectionId,
		});

		return { success: true };
	}

	return {
		updateEvent,
		deleteEvent,
	};
}
