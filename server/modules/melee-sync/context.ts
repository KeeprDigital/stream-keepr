import type { H3Event } from 'h3';
import { getOriginConnectionId } from '~~/server/utils/ably';

/**
 * What a Melee Sync run carries from whoever started it. An operator's request
 * names its realtime connection so that client skips its own echo; a scheduled
 * run has no origin and leaves it unset.
 */
export interface MeleeSyncContext {
	originConnectionId?: string;
}

export function meleeSyncContextFrom(requestEvent: H3Event): MeleeSyncContext {
	return {
		originConnectionId: getOriginConnectionId(requestEvent),
	};
}
