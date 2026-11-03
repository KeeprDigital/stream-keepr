import type { FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';
import { reactive } from 'vue';

/** The part of the Feature Match State store that holds the Session the Live State Follower follows per Slot. */
export interface FollowedFeatureMatchSessions {
	sessionIdBySlotId: Map<number, number>;
	featureMatchSessions: Map<number, FeatureMatchSessionResponse>;
}

/** A stand-in for `useFeatureMatchStateStore`, following no Session until a test says so. */
export function createFollowedFeatureMatchSessions(): FollowedFeatureMatchSessions {
	return reactive({
		sessionIdBySlotId: new Map(),
		featureMatchSessions: new Map(),
	}) as FollowedFeatureMatchSessions;
}

interface SeatedSlot {
	id: number;
	player1Id?: number | null;
	player2Id?: number | null;
	player1Data?: object | null;
	player2Data?: object | null;
}

/** Follow a Session of `slot` that `SwapPlayers` has swapped: the Slot's player2 sits on player1's side (ADR-0058). */
export function followSwappedSession(followed: FollowedFeatureMatchSessions, slot: SeatedSlot, sessionId = 90) {
	followed.sessionIdBySlotId = new Map([
		[slot.id, sessionId],
	]);
	followed.featureMatchSessions = new Map([
		[
			sessionId,
			{
				id: sessionId,
				sourceSnapshot: {
					playersSwapped: true,
					player1: { playerId: slot.player2Id ?? null, data: slot.player2Data ?? null },
					player2: { playerId: slot.player1Id ?? null, data: slot.player1Data ?? null },
				},
			} as unknown as FeatureMatchSessionResponse,
		],
	]);
}

/** Follow no Session for any Slot. */
export function followNoSession(followed: FollowedFeatureMatchSessions) {
	followed.sessionIdBySlotId = new Map();
	followed.featureMatchSessions = new Map();
}
