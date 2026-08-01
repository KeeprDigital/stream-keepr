import type { FeatureMatchSessionCommand, FeatureMatchSessionCommandResult } from '~~/shared/types/featureMatchSession';
import { mapFeatureMatchSessionToResponse } from '~~/server/mappers/featureMatch';
import { broadcastGraphicsLiveSessionModule } from '~~/server/modules/broadcast-graphics-live-session';
import { featureMatchStateService } from '~~/server/services/featureMatchState';
import { publishMessage } from '~~/server/utils/ably';

/**
 * Server-side Feature Match Session workflow module.
 *
 * This module is the external seam for route handlers that need session
 * persistence plus realtime publication. The state service supplies the Feature
 * Match half of the shared sequenced live-state module — which owns sequencing,
 * receipts, and publication — while the shared Feature Match Session module owns
 * reducer behaviour.
 */
export function featureMatchSessionModule() {
	const stateService = featureMatchStateService();

	/**
	 * Catch up any Broadcast Graphic bound to this Feature Match Slot's live state.
	 *
	 * A Graphic Input Binding may read discrete live scalar state from a Feature Match
	 * Slot — a life total, a game-wins line — so a Feature Match Session command moves
	 * what a bound Graphic Input resolves exactly as an Event Data write does. It is
	 * the only such change that does not pass through Event Data publication, so it
	 * asks for the same re-resolution here.
	 *
	 * Best-effort, for the same reason it is there: the session command has committed,
	 * and a Broadcast Graphic that fails to catch up must not report the command failed.
	 */
	async function refreshBoundBroadcastGraphics(
		eventId: number,
		originConnectionId?: string,
	): Promise<void> {
		try {
			await broadcastGraphicsLiveSessionModule().refreshLiveBindings({ eventId, originConnectionId });
		}
		catch {
			console.error(JSON.stringify({ message: 'broadcast_graphics_binding_refresh_failed', eventId }));
		}
	}

	async function createSessionForSlot(
		slotId: number,
		eventId: number,
		originConnectionId?: string,
	) {
		const session = await stateService.createSessionForSlot(slotId, eventId);
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
		await refreshBoundBroadcastGraphics(eventId, originConnectionId);

		return response;
	}

	async function applyCommand(
		sessionId: number,
		eventId: number,
		command: FeatureMatchSessionCommand,
		originConnectionId?: string,
	): Promise<FeatureMatchSessionCommandResult> {
		const result = await stateService.applyCommand(sessionId, eventId, command, originConnectionId, { publish: true });
		await refreshBoundBroadcastGraphics(eventId, originConnectionId);
		return result;
	}

	return {
		createSessionForSlot,
		applyCommand,
	};
}
