/**
 * A Round's operator-entered timing as the Event Structure page shows and edits
 * it (ADR-0066). Its start arrives as an ISO string over the wire, whatever the
 * response type declares (see `shared/api/index.ts`), so both shapes are read.
 */

interface RoundTimingFields {
	startedAt: Date | string | null;
	durationMinutes: number | null;
}

/** The start in this browser's time of day, as `HH:MM`. */
function formatStartTime(startedAt: Date | string): string {
	return new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** "50 min · started 10:02", or whichever half is set; `null` with neither. */
export function formatRoundTiming(round: RoundTimingFields): string | null {
	const parts = [
		round.durationMinutes != null
			? `${round.durationMinutes} min`
			: null,
		round.startedAt
			? `started ${formatStartTime(round.startedAt)}`
			: null,
	].filter(part => part != null);
	if (parts.length === 0)
		return null;
	const text = parts.join(' · ');
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A start as a `datetime-local` input holds it, in this browser's zone; `''` with none. */
export function toDateTimeLocalValue(startedAt: Date | string | null): string {
	if (!startedAt)
		return '';
	const date = new Date(startedAt);
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 19);
}

/** A `datetime-local` value as the ISO instant a Round write takes; `null` when cleared or unreadable. */
export function fromDateTimeLocalValue(value: string): string | null {
	if (!value)
		return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime())
		? null
		: date.toISOString();
}
