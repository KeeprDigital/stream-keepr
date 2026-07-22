import type { H3Event } from 'h3';
import { mapRoundToResponse } from '~~/server/mappers/round';
import { eventDataPublicationModule } from '~~/server/modules/event-data-publication';
import { roundService } from '~~/server/services/round';
import { getOriginConnectionId } from '~~/server/utils/ably';
import { isManualOverrideRound } from '~~/shared/utils/roundControl';

async function publishRoundUpdated(eventId: number, round: NonNullable<Awaited<ReturnType<ReturnType<typeof roundService>['findById']>>>, originConnectionId: string | undefined) {
	return await eventDataPublicationModule().roundUpdated({
		eventId,
		entity: round,
		originConnectionId,
	});
}

export function roundControlModule() {
	async function enableManualOverride(requestEvent: H3Event, eventId: number, roundId: number) {
		const roundSvc = roundService();
		const round = await roundSvc.findById(roundId, eventId);
		if (!round) {
			throw createError({ statusCode: 404, message: 'Round not found' });
		}

		if (isManualOverrideRound(round)) {
			return mapRoundToResponse(round);
		}

		const updatedRound = await roundSvc.update(roundId, eventId, { controlMode: 'manual_override' });
		if (!updatedRound) {
			throw createError({ statusCode: 500, message: 'Failed to enable manual override' });
		}

		return await publishRoundUpdated(eventId, updatedRound, getOriginConnectionId(requestEvent));
	}

	return {
		enableManualOverride,
	};
}
