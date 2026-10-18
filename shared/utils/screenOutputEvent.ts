import type { EventListResponse } from '~~/shared/api';

/**
 * The Event fields a Screen Output renders with, and the whole of what its
 * capability may read about its Event (#604). An allowlist, so a column added
 * to the Event tomorrow stays operator-only until someone decides otherwise.
 */
export const SCREEN_OUTPUT_EVENT_FIELDS = [
	'id',
	'name',
	'game',
	'featureMatchOrientation',
	'displayRecordSeparator',
	'displayHideZeroDraws',
	'displayPositionFormat',
	'featureMatchDefaultBestOf',
	'featureMatchDefaultStartingLife',
	'featureMatchDefaultClockType',
	'featureMatchDefaultClockDuration',
	'featureMatchDefaultCountUpAfterCountdown',
	'featureMatchDefaultTurnTrackingEnabled',
	'featureMatchDefaultActivePlayerTrackingEnabled',
	'featureMatchDefaultExtraTurnsEnabled',
	'featureMatchDefaultExtraTurns',
	'featureMatchDefaultExtraTurnsLabel',
	'featureMatchDefaultMulliganTrackingEnabled',
	'standingsEnabled',
	'broadcastDeckListsEnabled',
	'lgsEnabled',
	'pronounsEnabled',
	'tableNumberEnabled',
] as const satisfies readonly (keyof EventListResponse)[];

export type ScreenOutputEvent = Pick<EventListResponse, typeof SCREEN_OUTPUT_EVENT_FIELDS[number]>;

/**
 * Narrow any Event shape to what a Screen Output may hold of it.
 *
 * Both sides use it: the server to answer the read, and the client to fold an
 * `event:updated` notification into the held context without widening it.
 */
export function toScreenOutputEvent(event: ScreenOutputEvent): ScreenOutputEvent {
	return Object.fromEntries(
		SCREEN_OUTPUT_EVENT_FIELDS.map(field => [field, event[field]]),
	) as ScreenOutputEvent;
}
