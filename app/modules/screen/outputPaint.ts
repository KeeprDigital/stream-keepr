import type { ScreenOutput } from '~~/shared/types/screenConfig';

/**
 * What a graphics Screen Output paints for a colour, for both render models: the
 * shared compositor's and the Feature Match Overlay's host-owned Frame and Source
 * Items.
 *
 * The Overlay and Fill Outputs paint the authored colour at its opacity. The Key
 * Output paints the final composed opacity as a grayscale alpha matte, so every
 * element there is pure white at its own opacity, over black: overlapping white
 * paint then accumulates exactly as alpha does (see the matte contract in
 * `~/modules/graphics/renderModel.ts`). A glow is paint like any other, so it
 * reaches the Key Output too, at its own opacity: a half-opaque glow is grey in
 * the matte, as the Fill Output it keys shows it.
 */

export function clampOpacity(value: number): number {
	return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

const HEX_COLOUR = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;

/** A Key Output paints opacity, never colour. */
export function paintColour(output: ScreenOutput, colour: string): string {
	return output === 'key' ? '#ffffff' : colour;
}

/**
 * A colour at an opacity, as one CSS value. A colour that is not six-digit hex
 * keeps its opacity through `color-mix`, rather than painting opaque.
 */
export function colourAtOpacity(output: ScreenOutput, colour: string, opacity: number): string {
	const alpha = clampOpacity(opacity);
	const channel = Math.round(alpha * 255).toString(16).padStart(2, '0');

	if (output === 'key')
		return `#ffffff${channel}`;
	if (alpha >= 1)
		return colour;

	const hex = HEX_COLOUR.exec(colour.trim());
	if (hex)
		return `#${hex[1]}${hex[2]}${hex[3]}${channel}`.toLowerCase();
	return `color-mix(in srgb, ${colour} ${Math.round(alpha * 100)}%, transparent)`;
}

/** A glow as either render model paints it: a blur of the element's own alpha. */
export interface GlowPaint {
	color: string;
	size: number;
	opacity: number;
}

/**
 * The glow fields the Feature Match Overlay Frame and a Source Item's framing
 * store flat beside their border. A Graphic Surface Style always stores its
 * glow's colour and opacity, so these defaults are the flat hosts' alone.
 */
export interface BorderGlowFields {
	borderColor?: string;
	glowColor?: string;
	glowSize?: number;
	glowOpacity?: number;
}

const BORDER_GLOW_DEFAULT_COLOUR = '#ffffff';
const BORDER_GLOW_DEFAULT_OPACITY = 0.75;

/**
 * A flat border glow, or none: a stored size of zero is how there is no glow. A
 * glow without its own colour takes the border's, and without its own opacity
 * paints at three quarters.
 */
export function borderGlow(style: BorderGlowFields): GlowPaint | undefined {
	const size = style.glowSize ?? 0;
	if (size <= 0)
		return undefined;
	return {
		color: style.glowColor ?? style.borderColor ?? BORDER_GLOW_DEFAULT_COLOUR,
		size,
		opacity: style.glowOpacity ?? BORDER_GLOW_DEFAULT_OPACITY,
	};
}

function paintsGlow(glow: GlowPaint | undefined): glow is GlowPaint {
	return Boolean(glow && glow.size > 0 && clampOpacity(glow.opacity) > 0);
}

/**
 * A glow as a CSS `drop-shadow`, which composites its shadow under the source and
 * draws the result source-over: in the Key Output a white shadow at the glow's
 * opacity accumulates like any other white paint.
 */
export function glowDropShadow(output: ScreenOutput, glow: GlowPaint | undefined): string | undefined {
	if (!paintsGlow(glow))
		return undefined;
	return `drop-shadow(0 0 ${glow.size}px ${colourAtOpacity(output, glow.color, glow.opacity)})`;
}

/**
 * The same glow as an SVG `feDropShadow`, whose opacity is its own attribute. A
 * CSS drop-shadow's radius is twice the Gaussian's standard deviation, so both
 * forms blur the same distance.
 */
export function glowFlood(
	output: ScreenOutput,
	glow: GlowPaint | undefined,
): { stdDeviation: number; color: string; opacity: number } | undefined {
	if (!paintsGlow(glow))
		return undefined;
	return {
		stdDeviation: Math.max(0.1, glow.size / 2),
		color: paintColour(output, glow.color),
		opacity: clampOpacity(glow.opacity),
	};
}
