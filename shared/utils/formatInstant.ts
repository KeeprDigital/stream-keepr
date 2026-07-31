/**
 * One instant as the reader's local date and time.
 *
 * Every administrator surface shows the same kinds of instant — a deadline, a
 * recorded decision, the moment a reading was taken — and an absent one is a
 * real answer rather than a blank, so it is named rather than left empty.
 */
export function formatInstant(instant: string | null | undefined): string {
	return instant ? new Date(instant).toLocaleString() : 'None';
}
