/**
 * How a paged table Display sizes its rows to fill the Screen: a page of rows
 * shares the table's measured height, and type (and, for compact rows,
 * padding) grows with the row height.
 *
 * - `compact`: dense data tables (Standings, Metagame), padding sized here.
 * - `roomy`: tall rows of one Match each (Player History, Pairings), padding
 *   left to the Display's stylesheet.
 */
export type TableRowDensity = 'compact' | 'roomy';

interface DensityRule {
	/** Row height used before the table has been measured. */
	naturalRowHeight: number;
	/** No row is squeezed below this height. */
	minRowHeight: number;
	/** Primary type size at `fontBaseRowHeight`, and its floor. */
	baseFontSize: number;
	fontBaseRowHeight: number;
	/** Primary type pixels gained per pixel of row height. */
	fontGrowth: number;
	minSecondaryFontSize: number;
	secondaryFontScale: number;
	sizesPadding: boolean;
}

const DENSITY_RULES: Record<TableRowDensity, DensityRule> = {
	compact: {
		naturalRowHeight: 44,
		minRowHeight: 24,
		baseFontSize: 14,
		fontBaseRowHeight: 36,
		fontGrowth: 0.16,
		minSecondaryFontSize: 12,
		secondaryFontScale: 0.84,
		sizesPadding: true,
	},
	roomy: {
		naturalRowHeight: 72,
		minRowHeight: 44,
		baseFontSize: 18,
		fontBaseRowHeight: 56,
		fontGrowth: 0.2,
		minSecondaryFontSize: 13,
		secondaryFontScale: 0.72,
		sizesPadding: false,
	},
};

export interface TableRowLayoutInput {
	density: TableRowDensity;
	/** The rows' container height in px; 0 while unmeasured. */
	measuredHeight: number;
	/** Rows a full page lays out, so a short last page keeps the same sizing. */
	rowCount: number;
	/** Vertical page inset taken out of the measured height. */
	insetY?: number;
}

export interface TableRowLayout {
	rowHeight: number;
	fontSize: number;
	secondaryFontSize: number;
	/** Row padding, or null when the density leaves padding to the Display. */
	padding: { y: number; x: number } | null;
}

export function tableRowLayout({ density, measuredHeight, rowCount, insetY = 0 }: TableRowLayoutInput): TableRowLayout {
	const rule = DENSITY_RULES[density];
	const rows = Math.max(rowCount, 1);
	const availableHeight = measuredHeight > 0 ? measuredHeight : rows * rule.naturalRowHeight;
	const usableHeight = Math.max(availableHeight - insetY, rows * rule.minRowHeight);
	const rowHeight = usableHeight / rows;
	const fontSize = Math.max(rule.baseFontSize, rule.baseFontSize + ((rowHeight - rule.fontBaseRowHeight) * rule.fontGrowth));
	const secondaryFontSize = Math.max(rule.minSecondaryFontSize, fontSize * rule.secondaryFontScale);
	const padding = rule.sizesPadding
		? { y: Math.max(4, rowHeight * 0.12), x: Math.max(10, fontSize * 0.75) }
		: null;

	return { rowHeight, fontSize, secondaryFontSize, padding };
}

/**
 * The layout as the custom properties a Display's stylesheet reads, named
 * `--<prefix>-row-*`.
 */
export function tableRowLayoutStyle(prefix: string, layout: TableRowLayout): Record<string, string> {
	const style: Record<string, string> = {
		[`--${prefix}-row-height`]: `${layout.rowHeight}px`,
		[`--${prefix}-row-font-size`]: `${layout.fontSize}px`,
		[`--${prefix}-row-secondary-font-size`]: `${layout.secondaryFontSize}px`,
	};

	if (layout.padding) {
		style[`--${prefix}-row-padding-y`] = `${layout.padding.y}px`;
		style[`--${prefix}-row-padding-x`] = `${layout.padding.x}px`;
	}

	return style;
}
