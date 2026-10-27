import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ScreenModeTokenOfType, ThemedScreenMode } from '~~/shared/screenModes';
import type { ScreenMode } from '~~/shared/types/enums';
import {
	FOUNDATION_TOKENS,
	resolveThemeTokens,
	themeTokenCssProperties,
	themeTokenVar,
	themeTypographyStyle,
} from '~~/shared/modules/theme';
import { screenModeTokenName, screenModeTokens } from '~~/shared/screenModes';

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

/** One of a display's own colour or dimension Mode Tokens, as a CSS value. */
export function modeTokenVar<M extends ThemedScreenMode>(mode: M, token: ScreenModeTokenOfType<M, 'color' | 'dimension'>): string {
	return themeTokenVar(screenModeTokenName(mode, token));
}

/** One of a display's own typography Mode Tokens, as the style declarations that set it. */
export function modeTypographyStyle<M extends ThemedScreenMode>(mode: M, token: ScreenModeTokenOfType<M, 'typography'>) {
	return themeTypographyStyle(screenModeTokenName(mode, token));
}
