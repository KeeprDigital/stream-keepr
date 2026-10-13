import type { FeatureMatchOverlayGlowPosition } from '~~/shared/types/screenConfig';

/**
 * The value the one border and glow fields control edits, in its own neutral
 * shape. Each host maps it from and to what it stores: a Feature Match Overlay
 * Frame's or Source Item's per-side border, or a Graphic Surface Style's uniform
 * outline. `color` is whatever the host's colour slot edits: a CSS colour, or a
 * Graphic Style Set palette entry id.
 */
export const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const;

export type BorderSide = typeof BORDER_SIDES[number];

export interface BorderFieldsValue {
	color?: string;
	width: number;
	/** Only read where the host offers per-side borders. A missing side is shown. */
	sides?: Partial<Record<BorderSide, boolean>>;
}

export interface GlowFieldsValue {
	color?: string;
	size: number;
	opacity: number;
	/** Only read where the host offers a glow position. Absent means both. */
	position?: FeatureMatchOverlayGlowPosition;
}

/**
 * One author change. A `null` patch switches the border or glow off and `{}`
 * switches it on, so the host decides what an empty one holds, as
 * `GraphicSurfaceStyleEdit` does. Only a host offering per-side borders
 * receives `border-side`.
 */
export type BorderGlowEdit
	= | { kind: 'border'; patch: Partial<Pick<BorderFieldsValue, 'color' | 'width'>> | null }
		| { kind: 'border-side'; side: BorderSide; visible: boolean }
		| { kind: 'glow'; patch: Partial<GlowFieldsValue> | null };
