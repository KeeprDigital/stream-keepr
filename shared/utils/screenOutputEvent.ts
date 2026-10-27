import type { EventListResponse } from '~~/shared/api';
import type { ScreenOutputTheme } from '~~/shared/types/theme';

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
	'themeId',
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
	'featureMatchDefaultUntimedLabel',
	'featureMatchDefaultMulliganTrackingEnabled',
	'standingsEnabled',
	'broadcastDeckListsEnabled',
	'lgsEnabled',
	'pronounsEnabled',
	'tableNumberEnabled',
] as const satisfies readonly (keyof EventListResponse)[];

export type ScreenOutputEvent = Pick<EventListResponse, typeof SCREEN_OUTPUT_EVENT_FIELDS[number]> & {
	/**
	 * What a Screen needs of its Event's Theme to resolve its tokens: the Theme
	 * `themeId` names, or null for the Default Theme. The read always carries
	 * it; an `event:updated` never does, so a fold keeps the held one, and a
	 * held Theme that is not `themeId`'s is due a re-read.
	 */
	theme?: ScreenOutputTheme | null;
};

/**
 * Narrow any Event shape to what a Screen Output may hold of it.
 *
 * Both sides use it: the server to answer the read, and the client to fold an
 * `event:updated` notification into the held context without widening it.
 */
export function toScreenOutputEvent(event: ScreenOutputEvent): ScreenOutputEvent {
	const narrowed = Object.fromEntries(
		SCREEN_OUTPUT_EVENT_FIELDS.map(field => [field, event[field]]),
	) as ScreenOutputEvent;
	return event.theme === undefined
		? narrowed
		: { ...narrowed, theme: event.theme };
}

/** Whether a held Event context holds the Theme its Event uses. */
export function holdsSelectedTheme(event: ScreenOutputEvent): boolean {
	return (event.theme?.id ?? null) === (event.themeId ?? null);
}
