import type { DbEventTalent } from '~~/server/db/schema';
import type { TalentResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapTalentToResponse(talent: DbEventTalent): TalentResponse {
	return mapTimestamps(talent);
}
