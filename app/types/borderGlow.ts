/**
 * The value the one border and glow fields control edits, in its own neutral
 * shape: a uniform border and a glow. Each host maps it from and to what it
 * stores, a Graphic Surface Style's outline and glow. `color` is whatever the
 * host's colour slot edits.
 */
export interface BorderFieldsValue {
	color?: string;
	width: number;
}

export interface GlowFieldsValue {
	color?: string;
	size: number;
	opacity: number;
}

/**
 * One author change. A `null` patch switches the border or glow off and `{}`
 * switches it on, so the host decides what an empty one holds, as
 * `GraphicSurfaceStyleEdit` does.
 */
export type BorderGlowEdit
	= | { kind: 'border'; patch: Partial<BorderFieldsValue> | null }
		| { kind: 'glow'; patch: Partial<GlowFieldsValue> | null };
