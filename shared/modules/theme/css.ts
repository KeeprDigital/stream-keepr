import type { ThemeTypography } from './tokens';
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
 * Resolved token values as the custom properties a Screen host sets for its
 * display. A token a property cannot carry, such as an asset or a Background
 * Layer stack, sets none: its consumer reads the resolved value itself.
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
