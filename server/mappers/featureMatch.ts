import type { DbFeatureMatch, DbFeatureMatchSession } from '~~/server/db/schema';
import type { FeatureMatchResponse } from '~~/shared/api';
import type { FeatureMatchSessionEventAppliedPayload, FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapFeatureMatchSessionToResponse(session: DbFeatureMatchSession): FeatureMatchSessionResponse {
	return mapTimestamps(session);
}

/**
 * The `SessionStarted` announcement of a new Feature Match Session. It carries the
 * Session's whole snapshot, so a follower holds it as a newer epoch without a
 * reload (ADR-0026).
 */
export function mapFeatureMatchSessionToStarted(session: DbFeatureMatchSession): FeatureMatchSessionEventAppliedPayload {
	const response = mapFeatureMatchSessionToResponse(session);
	return {
		slotId: response.slotId,
		sessionId: response.id,
		sequence: response.sequence,
		eventType: 'SessionStarted',
		sourceSnapshot: response.sourceSnapshot,
		currentState: response.currentState,
	};
}

/** A Slot as read with its active Session. */
export type DbFeatureMatchWithSession = DbFeatureMatch & { activeSession?: DbFeatureMatchSession | null };

export function mapFeatureMatchToResponse(match: DbFeatureMatchWithSession): FeatureMatchResponse {
	const mapped = mapTimestamps(match);
	return {
		...mapped,
		activeSession: match.activeSession
			? mapFeatureMatchSessionToResponse(match.activeSession)
			: null,
	};
}
