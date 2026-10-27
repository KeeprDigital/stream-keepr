// Which Theme Tokens a Screen may override, and what an override write may
// store (ADR-0049). It sits beside `themeTokens.ts`, whose Theme write rules a
// Screen Theme Override shares.

import type { ThemeTokenReference, ThemeTokenValue } from './modules/theme/tokens';
import type { ScreenMode } from './types/enums';
import { FOUNDATION_TOKENS } from './modules/theme/vocabulary';
import { screenModeHostTokens } from './screenModeDefinitions';
import { screenModeSupportsBackgroundLayers, screenModeTokens } from './screenModes';
import { parseThemeTokenWrite, themeTokenDefinition } from './themeTokens';
import { THEME_TOKEN_WRITE_REFUSALS } from './types/theme';

/** Why a Screen Theme Override write was refused. */
export const SCREEN_THEME_OVERRIDE_REFUSALS = {
	...THEME_TOKEN_WRITE_REFUSALS,
	'unconsumable-token': 'This Screen\'s mode cannot consume this Theme Token',
} as const;

export type ScreenThemeOverrideRefusal = keyof typeof SCREEN_THEME_OVERRIDE_REFUSALS;

/**
 * Whether a Screen in `mode` can consume `name`: one of the mode's own Mode
 * Tokens, a Foundation Token its host consumes itself, or a Foundation Token
 * one of its Mode Tokens could follow. A Mode Token may be pointed at any
 * Foundation Token of its type, so that is every Foundation Token of a type
 * the mode declares, not only those its defaults name. The `background` stack
 * is consumed by the Screen host rather than a Mode Token, on the Background
 * Screen and every mode declaring a Background Layer stack.
 */
export function screenModeCanConsume(mode: ScreenMode, name: string): boolean {
	const modeTokens = screenModeTokens(mode);
	if (Object.hasOwn(modeTokens, name))
		return true;
	if (screenModeHostTokens(mode).includes(name))
		return true;
	if (name === 'background' && (mode === 'background' || screenModeSupportsBackgroundLayers(mode)))
		return true;
	if (!Object.hasOwn(FOUNDATION_TOKENS, name))
		return false;
	const { type } = FOUNDATION_TOKENS[name as keyof typeof FOUNDATION_TOKENS];
	return Object.values(modeTokens).some(definition => definition.type === type);
}

export type ScreenThemeOverrideWrite
	= | { ok: true; value: ThemeTokenValue | ThemeTokenReference | null }
		| { ok: false; refusal: ScreenThemeOverrideRefusal };

/**
 * What a Screen in `mode` may store as its override of `name`, or why not. A
 * `null` value clears the override. A set holds what a Theme may hold for the
 * token (`parseThemeTokenWrite`); a set or clear of a token the mode cannot
 * consume is refused, while one stored for another mode stays dormant.
 */
export function parseScreenThemeOverrideWrite(mode: ScreenMode, name: string, value: unknown): ScreenThemeOverrideWrite {
	if (!themeTokenDefinition(name))
		return { ok: false, refusal: 'unknown-token' };
	if (!screenModeCanConsume(mode, name))
		return { ok: false, refusal: 'unconsumable-token' };
	if (value === null)
		return { ok: true, value: null };
	return parseThemeTokenWrite(name, value);
}
