import type { FeatureMatchSessionCommand, FeatureMatchSessionCommandResult } from '~~/shared/types/featureMatchSession';
import { mapFeatureMatchSessionToResponse } from '~~/server/mappers/featureMatch';
import { refreshBroadcastGraphicsBindings } from '~~/server/modules/broadcast-graphics-live-session';
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

	/*
	 * Why a Feature Match Session command catches Broadcast Graphics up.
	 *
	 * A Graphic Input Binding may read discrete live scalar state from a Feature Match
	 * Slot — a life total, a game-wins line — so a session command moves what a bound
	 * Graphic Input resolves exactly as an Event Data write does. It is the only such
	 * change that does not pass through Event Data publication, so it asks for the same
	 * re-resolution here or a bound lower third never hears about it.
	 *
	 * ## The cost this deliberately accepts
	 *
	 * Every session command pays for it, including the ones an operator issues in
	 * bursts — a life total ticking down is one command per press. The sweep is two
	 * indexed queries for the Event plus one Event Data load per Broadcast Graphic that
	 * is both on program and carries a live-policy bound input, awaited before the
	 * response returns. There is no cheaper correct filter available here: a session
	 * command's own Slot does not bound which graphics are affected, because a binding
	 * may reach the Slot through a fixed relationship from a selection naming something
	 * else, and guessing wrong leaves a stale value on program.
	 *
	 * What bounds it in practice is the authored filter inside the sweep: a Screen whose
	 * graphics declare no live-policy binding costs the two queries and nothing more.
	 * If that stops being enough, the shape to reach for is coalescing a burst rather
	 * than narrowing the sweep — the same move `featureMatchSlotsUpdated` already makes
	 * for its fifty Slots — and it is not made here because one command is not a burst
	 * this module can see the end of.
	 */

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
		await refreshBroadcastGraphicsBindings(eventId);

		return response;
	}

	async function applyCommand(
		sessionId: number,
		eventId: number,
		command: FeatureMatchSessionCommand,
		originConnectionId?: string,
	): Promise<FeatureMatchSessionCommandResult> {
		const result = await stateService.applyCommand(sessionId, eventId, command, originConnectionId, { publish: true });
		await refreshBroadcastGraphicsBindings(eventId);
		return result;
	}

	return {
		createSessionForSlot,
		applyCommand,
	};
}
