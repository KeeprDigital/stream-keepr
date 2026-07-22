import type { DbMatch } from '~~/server/db/schema';
import type { MatchResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapMatchToResponse(match: DbMatch): MatchResponse {
	return mapTimestamps(match);
}
