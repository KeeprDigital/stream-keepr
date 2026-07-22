import type { DbPlayerList } from '~~/server/db/schema';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

interface DbPlayerListWithCount extends DbPlayerList {
	memberCount: number;
}

export function mapPlayerListToSummaryResponse(list: DbPlayerListWithCount) {
	return {
		...mapTimestamps(list),
		memberCount: list.memberCount,
	};
}

export function mapPlayerListToResponse(list: DbPlayerList) {
	return mapTimestamps(list);
}
