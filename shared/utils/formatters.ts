const ORDINAL_SUFFIXES = ['th', 'st', 'nd', 'rd'] as const;

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 */
export function getOrdinalSuffix(n: number): string {
	const v = n % 100;
	const idx1 = (v - 20) % 10;
	const idx2 = v;
	return (idx1 >= 0 && idx1 < ORDINAL_SUFFIXES.length ? ORDINAL_SUFFIXES[idx1] : undefined) ?? ORDINAL_SUFFIXES[idx2] ?? ORDINAL_SUFFIXES[0]!;
}

/**
 * Format a number as an ordinal string (e.g., 1 -> "1st", 2 -> "2nd")
 */
export function formatOrdinal(n: number): string {
	return `${n}${getOrdinalSuffix(n)}`;
}
