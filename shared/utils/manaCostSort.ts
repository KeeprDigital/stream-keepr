// WUBRG + colorless order. Index position determines sort rank within same CMC.
const MANA_COLOR_ORDER = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
type ManaColor = (typeof MANA_COLOR_ORDER)[number];

/**
 * Compares two card records by mana cost using the custom tournament sort order:
 *   1. CMC ascending — null CMC sorts last.
 *   2. Same CMC: single-colour cards ranked W→U→B→R→G→C, colourless (no colour) at C position.
 *   3. Multicolour cards (colors.length > 1) sort after all single-colour cards.
 *
 * Suitable for use as a TanStack Table `sortingFn`.
 */
export function sortByManaCost(
	a: { cmc?: number | null; colors?: string | null },
	b: { cmc?: number | null; colors?: string | null },
): number {
	// Primary: CMC — null to the end.
	const cmcA = a.cmc ?? Infinity;
	const cmcB = b.cmc ?? Infinity;
	if (cmcA !== cmcB)
		return cmcA - cmcB;

	// Secondary: multicolour last.
	const colorsA = a.colors ?? '';
	const colorsB = b.colors ?? '';
	const isMultiA = colorsA.length > 1;
	const isMultiB = colorsB.length > 1;
	if (isMultiA !== isMultiB)
		return isMultiA ? 1 : -1;
	if (isMultiA)
		return 0; // both multicolour — equal at this level

	// Tertiary: single-colour or colourless in WUBRGC order.
	// Empty/null colours (colourless artifacts etc.) rank with 'C'.
	const charA = (colorsA[0] ?? 'C') as ManaColor;
	const charB = (colorsB[0] ?? 'C') as ManaColor;
	const idxA = MANA_COLOR_ORDER.indexOf(charA);
	const idxB = MANA_COLOR_ORDER.indexOf(charB);
	// Unknown colour chars (shouldn't happen in practice) sort after C.
	return (idxA === -1 ? MANA_COLOR_ORDER.length : idxA) - (idxB === -1 ? MANA_COLOR_ORDER.length : idxB);
}
