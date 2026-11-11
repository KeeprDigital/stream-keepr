// Which Theme Tokens a Screen may override, and what an override write may
// store (ADR-0049). It sits beside `themeTokens.ts`, whose value rules a
// Screen Theme Override shares with a Theme.

import type { ThemeTokenValue } from './modules/theme/tokens';
import type { ScreenMode } from './types/enums';
import { screenModeHostTokens } from './screenModeDefinitions';
import { screenModeTokens } from './screenModes';
import { isFormerThemeToken, parseThemeTokenValue, themeTokenDefinition } from './themeTokens';
import { THEME_TOKEN_WRITE_REFUSALS } from './types/theme';

/** Why a Screen Theme Override write was refused. */
export const SCREEN_THEME_OVERRIDE_REFUSALS = {
	...THEME_TOKEN_WRITE_REFUSALS,
	'unconsumable-token': 'This Screen\'s mode cannot consume this Theme Token',
} as const;

export type ScreenThemeOverrideRefusal = keyof typeof SCREEN_THEME_OVERRIDE_REFUSALS;

/** Where a Screen's settings page renders each Theme Token it may override (ADR-0072). */
export interface ScreenThemeTokenPlacement {
	/** Each Screen Settings Group the mode's Mode Tokens name, with its Mode Tokens in declaration order. */
	groups: Readonly<Record<string, readonly string[]>>;
	/** Background & Placement: the Foundation Tokens the Screen's host consumes itself, a plain mode's `inset` and `alignment`. */
	placement: readonly string[];
}

/**
 * Where each Theme Token a Screen in `mode` may override renders: a Mode
 * Token in the group it names, a host token in Background & Placement. Every
 * other Foundation Token comes from the Theme alone, so none is listed.
 */
export function placeScreenThemeTokens(mode: ScreenMode): ScreenThemeTokenPlacement {
	const groups: Record<string, string[]> = {};
	for (const [name, definition] of Object.entries(screenModeTokens(mode)))
		(groups[definition.settingsGroup] ??= []).push(name);
	return {
		groups,
		placement: screenModeHostTokens(mode),
	};
}

/**
 * Whether a Screen in `mode` may override `name`: one of the mode's own Mode
 * Tokens, or a Foundation Token its host consumes itself (a plain mode's
 * `inset` and `alignment`).
 */
function screenThemeOverrideAdmits(mode: ScreenMode, name: string): boolean {
	return Object.hasOwn(screenModeTokens(mode), name)
		|| screenModeHostTokens(mode).includes(name);
}

export type ScreenThemeOverrideWrite
	= | { ok: true; dropped?: false; value: ThemeTokenValue | null }
		| { ok: true; dropped: true }
		| { ok: false; refusal: ScreenThemeOverrideRefusal };

/**
 * What a Screen in `mode` may store as its override of `name`, or why not. A
 * `null` value clears the override. A set holds a value the token may be
 * stored as (`parseThemeTokenValue`). Any other Foundation Token, which a
 * Screen takes from its Theme alone, and a former token, whichever mode
 * declared it, are accepted and `dropped`: nothing is stored or removed for
 * them. Another mode's Mode Token is refused, while one stored for it stays
 * dormant.
 */
export function parseScreenThemeOverrideWrite(mode: ScreenMode, name: string, value: unknown): ScreenThemeOverrideWrite {
	if (isFormerThemeToken(name))
		return { ok: true, dropped: true };
	const token = themeTokenDefinition(name);
	if (!token)
		return { ok: false, refusal: 'unknown-token' };
	if (!screenThemeOverrideAdmits(mode, name)) {
		return token.tier === 'foundation'
			? { ok: true, dropped: true }
			: { ok: false, refusal: 'unconsumable-token' };
	}
	if (value === null)
		return { ok: true, value: null };
	return parseThemeTokenValue(name, value);
}
