import type { DbEvent, DbEventTalent } from '~~/server/db/schema';
import type { EventListResponse, EventResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapEventListToResponse(event: DbEvent): EventListResponse {
	const {
		meleeClientId,
		meleeClientSecret,
		meleeSyncLeaseToken: _,
		meleeSyncLeaseCommand: __,
		meleeSyncLeaseExpiresAt: ___,
		...rest
	} = event;
	return {
		...mapTimestamps(rest),
		meleeConfigured: !!(meleeClientId && meleeClientSecret),
	};
}

export function mapEventToResponse(event: DbEvent & { talents: DbEventTalent[] }): EventResponse {
	const {
		meleeClientId,
		meleeClientSecret,
		meleeSyncLeaseToken: _,
		meleeSyncLeaseCommand: __,
		meleeSyncLeaseExpiresAt: ___,
		...rest
	} = event;
	return {
		...mapTimestamps(rest),
		meleeConfigured: !!(meleeClientId && meleeClientSecret),
	};
}
