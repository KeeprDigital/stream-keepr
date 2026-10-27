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
	return Math.max(0, Math.min(1, Number.isFinite(value)
		? value
		: 1));
}

const HEX_COLOUR = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i;

const HEX_WITH_ALPHA = /^#(?:[\da-f]{4}|[\da-f]{8})$/i;
const FUNCTIONAL_COLOUR = /^(?:rgba?|hsla?)\((.*)\)$/i;

/** The alpha argument of an `rgb()` or `hsl()` colour, when it has one. */
function functionalAlpha(args: string): string | undefined {
	const slash = args.split('/');
	if (slash.length === 2)
		return slash[1]!.trim();
	const commas = args.split(',');
	return commas.length === 4
		? commas[3]!.trim()
		: undefined;
}

/**
 * A colour's own alpha, 0 to 1: a translucent Theme colour carries one. A
 * colour whose alpha cannot be read here is opaque.
 */
export function colourAlpha(colour: string): number {
	const value = colour.trim();
	if (value.toLowerCase() === 'transparent')
		return 0;
	if (HEX_WITH_ALPHA.test(value)) {
		const digits = value.length === 5
			? value[4]!.repeat(2)
			: value.slice(7);
		return Number.parseInt(digits, 16) / 255;
	}
	const args = FUNCTIONAL_COLOUR.exec(value)?.[1];
	const alpha = args === undefined
		? undefined
		: functionalAlpha(args);
	if (alpha === undefined)
		return 1;
	return clampOpacity(alpha.endsWith('%')
		? Number.parseFloat(alpha) / 100
		: Number.parseFloat(alpha));
}

function keyWhite(alpha: number): string {
	const opacity = clampOpacity(alpha);
	return opacity >= 1
		? '#ffffff'
		: `#ffffff${Math.round(opacity * 255).toString(16).padStart(2, '0')}`;
}

/**
 * A Key Output paints opacity, never colour: white at the colour's own alpha,
 * so a translucent colour keys as the Fill Output shows it, and a consumer's
 * opacity multiplies it there as it does in the Fill.
 */
export function paintColour(output: ScreenOutput, colour: string): string {
	return output === 'key'
		? keyWhite(colourAlpha(colour))
		: colour;
}

/**
 * A colour at an opacity, as one CSS value. A colour that is not six-digit hex
 * keeps its opacity through `color-mix`, rather than painting opaque.
 */
export function colourAtOpacity(output: ScreenOutput, colour: string, opacity: number): string {
	const alpha = clampOpacity(opacity);
	const channel = Math.round(alpha * 255).toString(16).padStart(2, '0');

	if (output === 'key')
		return `#ffffff${Math.round(alpha * colourAlpha(colour) * 255).toString(16).padStart(2, '0')}`;
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
): { stdDeviation: number; floodColor: string; floodOpacity: number } | undefined {
	if (!paintsGlow(glow))
		return undefined;
	return {
		stdDeviation: Math.max(0.1, glow.size / 2),
		floodColor: paintColour(output, glow.color),
		floodOpacity: clampOpacity(glow.opacity),
	};
}
