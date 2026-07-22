import type { FeatureMatchSessionCommand, FeatureMatchSessionCommandResult } from '~~/shared/types/featureMatchSession';
import { mapFeatureMatchSessionToResponse } from '~~/server/mappers/featureMatch';
import { featureMatchStateService } from '~~/server/services/featureMatchState';
import { publishMessage } from '~~/server/utils/ably';

/**
 * Server-side Feature Match Session workflow module.
 *
 * This module is the external seam for route handlers that need session
 * persistence plus realtime publication. The lower-level state service remains
 * the persistence adapter while the shared Feature Match Session module owns
 * reducer behaviour.
 */
export function featureMatchSessionModule() {
	const stateService = featureMatchStateService();

	async function createSessionForSlot(
		slotId: number,
		eventId: number,
		originConnectionId?: string,
	) {
		const session = await stateService.createSessionForSlot(slotId, eventId, undefined, originConnectionId);
		if (!session)
			return null;

		const response = mapFeatureMatchSessionToResponse(session);
		await publishMessage(eventId, 'featureMatchSession:eventApplied', {
			slotId,
			sessionId: response.id,
			sequence: response.sequence,
			eventType: 'SessionStarted',
			sourceSnapshot: response.sourceSnapshot,
			currentState: response.currentState,
		}, originConnectionId);

		return response;
	}

	async function applyCommand(
		sessionId: number,
		eventId: number,
		command: FeatureMatchSessionCommand,
		originConnectionId?: string,
	): Promise<FeatureMatchSessionCommandResult> {
		const result = await stateService.applyCommand(sessionId, eventId, command, originConnectionId);
		await publishMessage(eventId, 'featureMatchSession:eventApplied', stateService.toEventAppliedPayload(result), originConnectionId);
		return result;
	}

	return {
		createSessionForSlot,
		applyCommand,
	};
}
