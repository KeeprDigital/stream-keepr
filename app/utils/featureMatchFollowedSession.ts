import type { FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';

/** Where the Feature Match state store holds the Session it follows for each Slot. */
interface FollowedSessions {
	sessionIdBySlotId?: ReadonlyMap<number, number>;
	featureMatchSessions?: ReadonlyMap<number, FeatureMatchSessionResponse>;
}

/** The Session the Live State Follower holds for a Slot, if it follows one. */
export function followedFeatureMatchSession(slotId: number, store: FollowedSessions): FeatureMatchSessionResponse | undefined {
	const sessionId = store.sessionIdBySlotId?.get(slotId);
	return sessionId === undefined
		? undefined
		: store.featureMatchSessions?.get(sessionId);
}

/**
 * A Feature Match Slot carrying the Session the Live State Follower holds for it,
 * rather than the one its last read carried.
 *
 * A Session command such as `SwapPlayers` moves the followed Session without
 * touching the Slot, and that Session's source snapshot decides which player each
 * side shows (ADR-0058). A Slot whose Session nobody follows keeps its own.
 */
export function withFollowedFeatureMatchSession<T extends { id: number; activeSession?: FeatureMatchSessionResponse | null }>(
	slot: T,
	store: FollowedSessions,
): T {
	const followed = followedFeatureMatchSession(slot.id, store);
	return followed && followed !== slot.activeSession
		? { ...slot, activeSession: followed }
		: slot;
}
