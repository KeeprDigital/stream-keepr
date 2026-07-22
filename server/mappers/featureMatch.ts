import type { DbFeatureMatch, DbFeatureMatchSession } from '~~/server/db/schema';
import type { FeatureMatchResponse } from '~~/shared/api';
import type { FeatureMatchSessionResponse } from '~~/shared/types/featureMatchSession';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapFeatureMatchSessionToResponse(session: DbFeatureMatchSession): FeatureMatchSessionResponse {
	return mapTimestamps(session);
}

export function mapFeatureMatchToResponse(match: DbFeatureMatch & { activeSession?: DbFeatureMatchSession | null }): FeatureMatchResponse {
	const mapped = mapTimestamps(match);
	return {
		...mapped,
		activeSession: match.activeSession ? mapFeatureMatchSessionToResponse(match.activeSession) : null,
	};
}
