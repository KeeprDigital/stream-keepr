import type { RecordSeparator } from '../types/enums';

/** A Player's wins, losses and draws, any of which may be unknown. */
export interface PlayerRecordFacts {
	wins: number | null | undefined;
	losses: number | null | undefined;
	draws: number | null | undefined;
}

/** How an Event displays records. */
export interface RecordDisplaySettings {
	displayRecordSeparator?: RecordSeparator | null;
	displayHideZeroDraws?: boolean | null;
}

/**
 * A record as the Event displays it: `3-1`, or `3-1-1` with draws, by its
 * separator, and with no draws shown unless the Event asks for them. A missing
 * figure counts as none.
 */
export function formatPlayerRecord(record: PlayerRecordFacts, settings: RecordDisplaySettings | null | undefined): string {
	const separator = settings?.displayRecordSeparator ?? '-';
	const hideZeroDraws = settings?.displayHideZeroDraws ?? true;
	const draws = record.draws ?? 0;
	const parts = [record.wins ?? 0, record.losses ?? 0];
	if (!(hideZeroDraws && draws === 0))
		parts.push(draws);
	return parts.join(separator);
}
