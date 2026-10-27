import type { DbEvent, DbEventTalent } from '~~/server/db/schema';
import type { EventListResponse, EventResponse } from '~~/shared/api';
import { mapTalentToResponse } from '~~/server/mappers/talent';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

/** Credentials, the sync lease, and the Live Results poll schedule never leave the server. */
function publicEventFields(event: DbEvent) {
	const {
		meleeClientId,
		meleeClientSecret,
		meleeSyncLeaseToken: _,
		meleeSyncLeaseCommand: __,
		meleeSyncLeaseExpiresAt: ___,
		meleeLiveResultsNextCheckAt: ____,
		meleeLiveResultsBackoffStep: _____,
		...rest
	} = event;
	return {
		...mapTimestamps(rest),
		meleeConfigured: !!(meleeClientId && meleeClientSecret),
	};
}

export function mapEventListToResponse(event: DbEvent): EventListResponse {
	return publicEventFields(event);
}

export function mapEventToResponse(event: DbEvent & { talents: DbEventTalent[] }): EventResponse {
	const { talents, ...rest } = event;
	return {
		...publicEventFields(rest),
		talents: talents.map(mapTalentToResponse),
	};
}
