/**
 * The nine reference points of a rectangle — corners, edge midpoints, centre —
 * as one table with the label, icon, and position every nine-point control
 * shows.
 *
 * Several domain vocabularies are spelled with exactly these nine values and
 * stay distinct concepts: the Graphic Anchor Point and the Graphic Animation
 * Origin (CONTEXT.md), and a Feature Match Overlay Source Item's anchor. What
 * they share is the geometry and the control, so the table lives here once and
 * each vocabulary's definitions are typed views of it; that the vocabularies
 * stay spelled alike is pinned in `test/unit/shared/ninePoints.test.ts`.
 *
 * A badge's position on a Deck Screen card is the same vocabulary less the
 * centre, which its picker disables rather than spelling the eight differently.
 */

export const NINE_POINT_VALUES = [
	'top-left',
	'top',
	'top-right',
	'left',
	'center',
	'right',
	'bottom-left',
	'bottom',
	'bottom-right',
] as const;

export type NinePoint = typeof NINE_POINT_VALUES[number];

export interface NinePointDefinition {
	value: NinePoint;
	label: string;
	icon: string;
	/** Fraction of the rectangle's width the point sits at. */
	x: number;
	/** Fraction of the rectangle's height the point sits at. */
	y: number;
}

/** In reading order, which is also the order a 3×3 grid lays them out. */
export const NINE_POINTS: readonly NinePointDefinition[] = [
	{ value: 'top-left', label: 'Top left', icon: 'i-lucide-arrow-up-left', x: 0, y: 0 },
	{ value: 'top', label: 'Top', icon: 'i-lucide-arrow-up', x: 0.5, y: 0 },
	{ value: 'top-right', label: 'Top right', icon: 'i-lucide-arrow-up-right', x: 1, y: 0 },
	{ value: 'left', label: 'Left', icon: 'i-lucide-arrow-left', x: 0, y: 0.5 },
	{ value: 'center', label: 'Centre', icon: 'i-lucide-crosshair', x: 0.5, y: 0.5 },
	{ value: 'right', label: 'Right', icon: 'i-lucide-arrow-right', x: 1, y: 0.5 },
	{ value: 'bottom-left', label: 'Bottom left', icon: 'i-lucide-arrow-down-left', x: 0, y: 1 },
	{ value: 'bottom', label: 'Bottom', icon: 'i-lucide-arrow-down', x: 0.5, y: 1 },
	{ value: 'bottom-right', label: 'Bottom right', icon: 'i-lucide-arrow-down-right', x: 1, y: 1 },
];
