import type { GraphicAnimationEasing, GraphicAnimationRecipe } from '../../types/graphics';
import type { ThemeTypography } from './tokens';
import { resolveGraphicAnimationOrigin, resolveGraphicSlideDirection } from '../graphics/animation';
import { resolveGraphicFontFamily } from '../graphics/typography';

/**
 * How resolved Theme Tokens reach a Screen Mode's display: as CSS custom
 * properties its Screen host sets, one per token, and one per typography
 * field. A display reads them through `themeTokenVar` and
 * `themeTypographyStyle` rather than spelling the property names.
 */

const TYPOGRAPHY_PROPERTIES = {
	fontFamily: 'font-family',
	fontWeight: 'font-weight',
	lineHeight: 'line-height',
	letterSpacing: 'letter-spacing',
	textTransform: 'text-transform',
} as const;

type TypographyProperty = keyof typeof TYPOGRAPHY_PROPERTIES;

/** A token's custom property, or one of a typography token's. */
function themeTokenCssProperty(name: string, part?: string): string {
	const base = `--theme-${name.replaceAll('.', '-')}`;
	return part
		? `${base}-${part}`
		: base;
}

function typographyCss(value: ThemeTypography): Record<TypographyProperty, string> {
	return {
		fontFamily: resolveGraphicFontFamily(value.font) ?? 'inherit',
		fontWeight: String(value.weight),
		lineHeight: String(value.lineHeight),
		letterSpacing: `${value.tracking}em`,
		textTransform: value.case,
	};
}

function isTypography(value: unknown): value is ThemeTypography {
	return typeof value === 'object' && value !== null && 'font' in value && 'weight' in value;
}

/**
 * The parts of a motion token a display's CSS transition reads: its timing,
 * and the excursion state the element travels from while entering and to
 * while leaving. Its resting state is opacity 1, no transform and no clip.
 */
const MOTION_PROPERTIES = {
	duration: 'duration',
	easing: 'easing',
	delay: 'delay',
	opacity: 'opacity',
	transform: 'transform',
	transformOrigin: 'origin',
	clipPath: 'clip',
} as const;

type MotionProperty = keyof typeof MOTION_PROPERTIES;

/** Each easing as the CSS timing function closest to its curve (`graphicAnimationEasedProgress`). */
const EASING_CSS: Record<GraphicAnimationEasing, string> = {
	'linear': 'linear',
	'ease-in': 'cubic-bezier(0.11, 0, 0.5, 0)',
	'ease-out': 'cubic-bezier(0.5, 1, 0.89, 1)',
	'ease-in-out': 'cubic-bezier(0.45, 0, 0.55, 1)',
	'back-in': 'cubic-bezier(0.36, 0, 0.66, -0.56)',
	'back-out': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
	'back-in-out': 'cubic-bezier(0.68, -0.6, 0.32, 1.6)',
};

/** Fully clipped from the opposite edge, so a reveal wipes in from `edge`. */
const REVEAL_CLIP = {
	left: 'inset(0 100% 0 0)',
	right: 'inset(0 0 0 100%)',
	top: 'inset(0 0 100% 0)',
	bottom: 'inset(100% 0 0 0)',
} as const;

/**
 * A slide's offset. One clearing its parent travels the whole Screen, which is
 * the size container its Screen host sets.
 */
function slideOffset(slide: NonNullable<GraphicAnimationRecipe['slide']>): string {
	const { x, y } = resolveGraphicSlideDirection(slide.direction);
	return slide.distanceMode === 'clear-parent'
		? `translate(calc(${x} * 100cqw), calc(${y} * 100cqh))`
		: `translate(${x * slide.distance}px, ${y * slide.distance}px)`;
}

/** A recipe with no channel cuts: it takes no time, as an absent recipe does. */
function motionCss(value: GraphicAnimationRecipe): Record<MotionProperty, string> {
	const origin = resolveGraphicAnimationOrigin(value.scale?.origin);
	const cuts = !value.fade && !value.slide && !value.scale && !value.reveal;
	return {
		duration: cuts
			? '0ms'
			: `${value.duration}ms`,
		easing: EASING_CSS[value.easing],
		delay: cuts
			? '0ms'
			: `${value.delay}ms`,
		opacity: String(value.fade?.opacity ?? 1),
		transform: [
			value.slide
				? slideOffset(value.slide)
				: 'translate(0px, 0px)',
			`scale(${value.scale?.factor ?? 1})`,
		].join(' '),
		transformOrigin: `${origin.x * 100}% ${origin.y * 100}%`,
		clipPath: value.reveal ? REVEAL_CLIP[value.reveal.edge] : 'inset(0 0 0 0)',
	};
}

function isMotion(value: unknown): value is GraphicAnimationRecipe {
	return typeof value === 'object' && value !== null && 'duration' in value && 'easing' in value;
}

/**
 * Resolved token values as the custom properties a Screen host sets for its
 * display, a motion token's as one per part. A token a property cannot carry,
 * such as an asset, a Background Layer stack or another composite only
 * Graphic Items consume, sets none: its consumer reads the resolved value itself.
 */
export function themeTokenCssProperties(values: Readonly<Record<string, unknown>>): Record<string, string> {
	const properties: Record<string, string> = {};
	for (const [name, value] of Object.entries(values)) {
		if (typeof value === 'string') {
			properties[themeTokenCssProperty(name)] = value;
		}
		else if (typeof value === 'number') {
			properties[themeTokenCssProperty(name)] = `${value}px`;
		}
		else if (isTypography(value)) {
			for (const [property, css] of Object.entries(typographyCss(value)))
				properties[themeTokenCssProperty(name, TYPOGRAPHY_PROPERTIES[property as TypographyProperty])] = css;
		}
		else if (isMotion(value)) {
			for (const [property, css] of Object.entries(motionCss(value)))
				properties[themeTokenCssProperty(name, MOTION_PROPERTIES[property as MotionProperty])] = css;
		}
	}
	return properties;
}

/** A colour or dimension token as a CSS value. */
export function themeTokenVar(name: string): string {
	return `var(${themeTokenCssProperty(name)})`;
}

/** A typography token as the style declarations that set it. */
export function themeTypographyStyle(name: string): Record<TypographyProperty, string> {
	const style = {} as Record<TypographyProperty, string>;
	for (const [property, part] of Object.entries(TYPOGRAPHY_PROPERTIES))
		style[property as TypographyProperty] = `var(${themeTokenCssProperty(name, part)})`;
	return style;
}

/** A motion token as the custom-property reads of its timing and excursion. */
export function themeMotionVars(name: string): Record<MotionProperty, string> {
	const vars = {} as Record<MotionProperty, string>;
	for (const [property, part] of Object.entries(MOTION_PROPERTIES))
		vars[property as MotionProperty] = `var(${themeTokenCssProperty(name, part)})`;
	return vars;
}
