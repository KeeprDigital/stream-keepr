import type { DbScreen } from '~~/server/db/schema';
import type { ScreenResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapScreenToResponse(screen: DbScreen): ScreenResponse {
	return mapTimestamps(screen);
}
