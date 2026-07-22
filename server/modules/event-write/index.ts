import type { UpdateEventInput } from '~~/server/schemas/api/event';
import type { EventResponse } from '~~/shared/api';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { cardService } from '~~/server/services/card';
import { eventService } from '~~/server/services/event';
import { featureMatchService } from '~~/server/services/featureMatch';
import { screenService } from '~~/server/services/screen';
import { requireTalentInEvent } from '~~/server/utils/routeGuards';

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
		await Promise.all([
			requireTalentInEvent(eventId, input.commentator1TalentId),
			requireTalentInEvent(eventId, input.commentator2TalentId),
		]);

		const updatedEvent = await events.update(eventId, input);

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
