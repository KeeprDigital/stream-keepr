import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { eventService } from '~~/server/services/event';

interface SetMeleeLiveResultsParams {
	eventId: number;
	enabled: boolean;
	originConnectionId?: string;
}

/**
 * The Live Results setting command. On only while Melee Sync is on; turning it
 * on starts a fresh poll, turning it off leaves the last poll state shown.
 * Answers and announces the updated Event.
 */
export async function setMeleeLiveResults({ eventId, enabled, originConnectionId }: SetMeleeLiveResultsParams) {
	const eventSvc = eventService();
	const updated = enabled
		? await eventSvc.enableMeleeLiveResults(eventId, new Date())
		: await eventSvc.disableMeleeLiveResults(eventId);

	if (!updated) {
		if (!await eventSvc.exists(eventId))
			throw createError({ statusCode: 404, message: 'Event not found' });
		throw createError({
			statusCode: 400,
			message: 'Turn Melee Sync on before turning Live Results on',
			data: { code: 'MELEE_SYNC_DISABLED' },
		});
	}

	const event = (await eventSvc.findById(eventId))!;
	return await eventDataPublicationModule().eventUpdated({
		eventId,
		entity: event,
		originConnectionId,
	});
}
