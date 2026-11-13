import type { ApplicationFontFaceRequest } from '~~/shared/modules/graphics/typography';
import type { FoundationTokenNameOfType, StoredThemeTokens, ThemeAlignment, ThemeBackgroundLayer, ThemeTypography } from '~~/shared/modules/theme';
import type { ScreenModeTokenOfType, ThemedScreenMode } from '~~/shared/screenModes';
import type { ScreenMode } from '~~/shared/types/enums';
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import {
	FOUNDATION_TOKENS,
	resolveFoundationToken,
	resolveFoundationTokens,
	themeMotionVars,
	themeTokenCssProperties,
	themeTokenVar,
	themeTypographyStyle,
} from '~~/shared/modules/theme';
import { PLAIN_HOST_TOKENS, resolveScreenThemeTokens, screenModeHostTokens } from '~~/shared/screenModeDefinitions';
import { screenModeTokenName, screenModeTokens } from '~~/shared/screenModes';
import { themeTokenValueGraphicAssetReferences } from '~~/shared/themeAssetReferences';

/** The Foundation Tokens whose library font a display may paint in. */
const FOUNDATION_TYPOGRAPHY_TOKENS = ['heading', 'body'] as const satisfies readonly FoundationTokenNameOfType<'typography'>[];

/**
 * The custom properties a Screen host sets for its mode's display: every
 * Foundation Token, from its Event's Theme (a host token from the Screen's
 * override first), and each of the mode's Mode Tokens, from the Screen's
 * override, else its default. A display reads the Theme's shared chrome from
 * the Foundation Tokens and only what is its own from its Mode Tokens; a token
 * no property can carry sets none.
 */
export function screenModeThemeTokenStyle(mode: ScreenMode, theme: StoredThemeTokens, overrides: StoredThemeTokens): Record<string, string> {
	const modeTokens = screenModeTokens(mode);
	const hostTokens = screenModeHostTokens(mode);
	const { values } = resolveScreenThemeTokens(mode, theme, overrides);
	return themeTokenCssProperties({
		...resolveFoundationTokens({
			vocabulary: FOUNDATION_TOKENS,
			theme,
			overrides,
			hostTokens,
		}),
		...Object.fromEntries(Object.keys(modeTokens).map(name => [name, values[name]])),
	});
}

/**
 * The typography a mode's display paints in, resolved, by token name: the
 * `heading` and `body` Foundation Tokens, and each typography Mode Token.
 */
function screenModeThemeTypography(mode: ScreenMode, theme: StoredThemeTokens, overrides: StoredThemeTokens): Array<readonly [string, ThemeTypography]> {
	const modeTokens = screenModeTokens(mode);
	const { values } = resolveScreenThemeTokens(mode, theme, overrides);
	return [
		...FOUNDATION_TYPOGRAPHY_TOKENS.map(name => [
			name,
			resolveFoundationToken({ vocabulary: FOUNDATION_TOKENS, theme, overrides }, name) as ThemeTypography,
		] as const),
		...Object.entries(modeTokens).flatMap(([name, definition]) => definition.type === 'typography'
			? [
					[name, values[name] as ThemeTypography] as const,
				]
			: []),
	];
}

/**
 * The library fonts a mode's display paints: the `heading` and `body`
 * Foundation Tokens, and each typography Mode Token, that resolve to a font
 * Graphic Asset Revision. Its Screen host loads them as `FontFace`s under the
 * family the token's custom property names.
 */
export function screenModeThemeFontReferences(mode: ScreenMode, theme: StoredThemeTokens, overrides: StoredThemeTokens): ScreenGraphicAssetReference[] {
	return screenModeThemeTypography(mode, theme, overrides)
		.flatMap(([name, value]) => themeTokenValueGraphicAssetReferences('typography', value, name));
}

/**
 * The application faces a Screen's resolved Theme typography paints with:
 * `heading`, `body`, and the mode's typography Mode Tokens, each at its token's
 * weight. A typography token sets no style, so each is `'normal'`. Its Screen
 * host waits for them as it does for the library fonts above.
 */
export function screenModeThemeApplicationFonts(mode: ScreenMode, theme: StoredThemeTokens, overrides: StoredThemeTokens): ApplicationFontFaceRequest[] {
	return screenModeThemeTypography(mode, theme, overrides).flatMap(([, { font, weight }]) => font.kind === 'application'
		? [
				{ fontId: font.fontId, weight, style: 'normal' as const },
			]
		: []);
}

/** A colour or dimension Foundation Token, as a CSS value a display reads directly. */
export function foundationTokenVar(token: FoundationTokenNameOfType<'color' | 'dimension'>): string {
	return themeTokenVar(token);
}

/** The Theme's heading or body type, as the style declarations that set it. */
export function foundationTypographyStyle(token: typeof FOUNDATION_TYPOGRAPHY_TOKENS[number]) {
	return themeTypographyStyle(token);
}

/** A motion Foundation Token, as the reads of its timing and excursion state. */
export function foundationMotionVars(token: FoundationTokenNameOfType<'animation-recipe'>) {
	return themeMotionVars(token);
}

/** One of a display's own colour or dimension Mode Tokens, as a CSS value. */
export function modeTokenVar<M extends ThemedScreenMode>(mode: M, token: ScreenModeTokenOfType<M, 'color' | 'dimension'>): string {
	return themeTokenVar(screenModeTokenName(mode, token));
}

/**
 * One of a display's own motion Mode Tokens, as the reads of its timing and of
 * the excursion state a CSS transition travels from and back to.
 */
export function modeMotionVars<M extends ThemedScreenMode>(mode: M, token: ScreenModeTokenOfType<M, 'animation-recipe'>) {
	return themeMotionVars(screenModeTokenName(mode, token));
}

/**
 * The Background Layer stack a Screen paints, from one of two sources: its own
 * when it has one, else its Theme's `background` Foundation Token. The
 * Background Screen's `layers` and a plain overlay mode's `backgroundLayers`
 * both follow it; an empty own stack is no stack, so the Theme's shows.
 */
export function screenBackgroundLayers(own: BackgroundLayer[] | undefined, theme: StoredThemeTokens): BackgroundLayer[] {
	if (own?.length)
		return own;
	// Resolved, so every colour layer holds a literal.
	return resolveFoundationToken({ vocabulary: FOUNDATION_TOKENS, theme, overrides: {} }, 'background') as ThemeBackgroundLayer<string>[];
}

/**
 * Where a plain mode's Screen host places its content in the Event Canvas: the
 * `inset` and `alignment` Foundation Tokens, from the Screen's overrides, its
 * Event's Theme and the defaults. A display sizing itself to the space left
 * inside the inset reads it here too.
 */
export function screenLayoutTokens(theme: StoredThemeTokens, overrides: StoredThemeTokens): { inset: number; alignment: ThemeAlignment } {
	const input = {
		vocabulary: FOUNDATION_TOKENS,
		theme,
		overrides,
		hostTokens: PLAIN_HOST_TOKENS,
	};
	return {
		inset: resolveFoundationToken(input, 'inset') as number,
		alignment: resolveFoundationToken(input, 'alignment') as ThemeAlignment,
	};
}
