import type { FeatureMatchOverlayBorderSides, FeatureMatchSourceFramingStyle } from '~~/shared/types/screenConfig';
import type { BorderFieldsValue, BorderGlowEdit, BorderSide, GlowFieldsValue } from '~/types/borderGlow';
import { borderGlow } from '~/modules/screen/outputPaint';
import { BORDER_SIDES } from '~/types/borderGlow';

/**
 * The border and glow fields the Feature Match Overlay Frame and a Source Item's
 * framing share: a per-side border and a glow stored flat on the style. Only a
 * Source Item stores a glow position.
 */
export type FeatureMatchBorderGlowStyle = FeatureMatchOverlayBorderSides & Pick<
	FeatureMatchSourceFramingStyle,
	'borderVisible' | 'borderColor' | 'borderWidth' | 'glowColor' | 'glowSize' | 'glowOpacity' | 'glowPosition'
>;

const SIDE_FIELDS = {
	top: 'borderTopVisible',
	right: 'borderRightVisible',
	bottom: 'borderBottomVisible',
	left: 'borderLeftVisible',
} as const satisfies Record<BorderSide, keyof FeatureMatchOverlayBorderSides>;

/** What the renderer paints when the field is unset. */
const RENDERED_BORDER_WIDTH = 1;

/** The size a glow takes when the author switches it on. */
const GLOW_SIZE_ON = 8;

/**
 * A stored size of 0 is how the renderer knows there is no glow, so only the
 * switch turns it off: a size typed down to nothing stays a 1px glow.
 */
const MIN_GLOW_SIZE = 1;

/**
 * The shared fields' view of a Feature Match Overlay border and glow: what the
 * renderer paints. A border is on only while `borderVisible` is set; the glow is
 * the one the renderer resolves (`borderGlow`).
 *
 * `unsetBorderColor` is the colour the host's renderer paints a border with no
 * colour of its own: a Source Item paints white, the Frame paints nothing.
 */
export function borderGlowFieldsValue(
	style: FeatureMatchBorderGlowStyle,
	unsetBorderColor?: string,
): { border: BorderFieldsValue | null; glow: GlowFieldsValue | null } {
	const glow = borderGlow(style);
	return {
		border: style.borderVisible === true
			? {
					color: style.borderColor ?? unsetBorderColor,
					width: style.borderWidth ?? RENDERED_BORDER_WIDTH,
					sides: Object.fromEntries(BORDER_SIDES.map(side => [side, style[SIDE_FIELDS[side]]])),
				}
			: null,
		glow: glow
			? { ...glow, position: style.glowPosition }
			: null,
	};
}

/**
 * The flat fields one edit from the shared fields changes. Switching the border
 * keeps its colour and width for the next time it is on; switching the glow off
 * zeroes its size, which is how the renderer knows there is none.
 */
export function borderGlowStyleUpdates(edit: BorderGlowEdit): Partial<FeatureMatchBorderGlowStyle> {
	if (edit.kind === 'border-side')
		return { [SIDE_FIELDS[edit.side]]: edit.visible };

	if (edit.kind === 'border') {
		if (!edit.patch)
			return { borderVisible: false };
		const { color, width } = edit.patch;
		return {
			...(Object.keys(edit.patch).length === 0 && { borderVisible: true }),
			...('color' in edit.patch && { borderColor: color }),
			...(width !== undefined && { borderWidth: width }),
		};
	}

	if (!edit.patch)
		return { glowSize: 0 };
	const { color, size, opacity, position } = edit.patch;
	return {
		...(Object.keys(edit.patch).length === 0 && { glowSize: GLOW_SIZE_ON }),
		...('color' in edit.patch && { glowColor: color }),
		...(size !== undefined && {
			glowSize: Math.max(MIN_GLOW_SIZE, size),
		}),
		...(opacity !== undefined && { glowOpacity: opacity }),
		...(position !== undefined && { glowPosition: position }),
	};
}
