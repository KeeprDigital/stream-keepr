import type { StoredThemeTokens, ThemeBackgroundLayer } from '~~/shared/modules/theme';
import type { ScreenModeTokenOfType, ThemedScreenMode } from '~~/shared/screenModes';
import type { ScreenMode } from '~~/shared/types/enums';
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import type { ScreenGraphicAssetReference } from '~~/shared/utils/graphicsAssetReferences';
import {
	FOUNDATION_TOKENS,
	resolveFoundationToken,
	resolveThemeTokens,
	themeTokenCssProperties,
	themeTokenVar,
	themeTypographyStyle,
} from '~~/shared/modules/theme';
import { screenModeTokenName, screenModeTokens } from '~~/shared/screenModes';
import { themeTokenValueGraphicAssetReferences } from '~~/shared/themeAssetReferences';

/**
 * The custom properties a Screen host sets for its mode's display: each of the
 * mode's Mode Tokens, resolved from the Screen's overrides, its Event's Theme
 * and the defaults. Only Mode Tokens are set, so a display can read nothing
 * else; a mode declaring none gets none.
 */
export function screenModeThemeTokenStyle(mode: ScreenMode, theme: StoredThemeTokens, overrides: StoredThemeTokens): Record<string, string> {
	const modeTokens = screenModeTokens(mode);
	const { values } = resolveThemeTokens({
		vocabulary: FOUNDATION_TOKENS,
		modeTokens,
		theme,
		overrides,
	});
	return themeTokenCssProperties(Object.fromEntries(Object.keys(modeTokens).map(name => [name, values[name]])));
}

/**
 * The library fonts a mode's display paints: each typography Mode Token that
 * resolves to a font Graphic Asset Revision. Its Screen host loads them as
 * `FontFace`s under the family the token's custom property names.
 */
export function screenModeThemeFontReferences(mode: ScreenMode, theme: StoredThemeTokens, overrides: StoredThemeTokens): ScreenGraphicAssetReference[] {
	const modeTokens = screenModeTokens(mode);
	const { values } = resolveThemeTokens({
		vocabulary: FOUNDATION_TOKENS,
		modeTokens,
		theme,
		overrides,
	});
	return Object.entries(modeTokens).flatMap(([name, definition]) => definition.type === 'typography'
		? themeTokenValueGraphicAssetReferences('typography', values[name]!, name)
		: []);
}

/** One of a display's own colour or dimension Mode Tokens, as a CSS value. */
export function modeTokenVar<M extends ThemedScreenMode>(mode: M, token: ScreenModeTokenOfType<M, 'color' | 'dimension'>): string {
	return themeTokenVar(screenModeTokenName(mode, token));
}

/** One of a display's own typography Mode Tokens, as the style declarations that set it. */
export function modeTypographyStyle<M extends ThemedScreenMode>(mode: M, token: ScreenModeTokenOfType<M, 'typography'>) {
	return themeTypographyStyle(screenModeTokenName(mode, token));
}

/**
 * The Background Layer stack a Screen paints: its own when it has one, else
 * its Theme's `background` Foundation Token. The Background Screen's `layers`
 * and a plain overlay mode's `backgroundLayers` both follow it; an empty own
 * stack is no stack, so the Theme's shows.
 */
export function screenBackgroundLayers(own: BackgroundLayer[] | undefined, theme: StoredThemeTokens, overrides: StoredThemeTokens): BackgroundLayer[] {
	if (own?.length)
		return own;
	return resolveFoundationToken({ vocabulary: FOUNDATION_TOKENS, theme, overrides }, 'background') as ThemeBackgroundLayer[];
}
