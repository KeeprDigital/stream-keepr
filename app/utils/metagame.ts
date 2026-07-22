/** Format a numeric percentage (e.g. 12.5 → "12.5%"), or '-' for null. */
export function formatPercent(value: number | null): string {
	if (value == null)
		return '-';
	return `${value}%`;
}

/** Return the maximum metaShare value in the entries array, for scaling inline bars. Minimum 1 to avoid division by zero. */
export function maxMetaShare(entries: { metaShare: number }[]): number {
	return entries.reduce((max, e) => Math.max(max, e.metaShare), 0) || 1;
}
