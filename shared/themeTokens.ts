// The whole Theme Token vocabulary a Theme may set: every Foundation Token,
// and every Mode Token a Screen Mode Definition declares. Stream Keepr owns
// each name (ADR-0049). It sits beside `screenModes.ts` rather than in
// `modules/theme`, because Mode Tokens are read off the Screen Mode
// Definitions, which already import that module.

import type { FoundationTokenDefinition, ThemeTokenValue } from './modules/theme/tokens';
import type { AnyDeclaredModeTokenDefinition, FoundationTokenName } from './modules/theme/vocabulary';
import type { ScreenModeTokenName } from './screenModes';
import type { ScreenMode } from './types/enums';
import type { ThemeTokenWriteRefusal } from './types/theme';
import { themeTokenValueSchema } from './modules/theme/tokens';
import { FOUNDATION_TOKENS } from './modules/theme/vocabulary';
import { SCREEN_MODES, screenModeFormerTokens, screenModeTokens } from './screenModes';
import { SCREEN_MODE_VALUES } from './types/enums';

/** The Mode Tokens of one themed Screen Mode, by full name, as a Theme editor groups them. */
export interface ThemedScreenModeTokens {
	mode: ScreenMode;
	label: string;
	tokens: Readonly<Record<ScreenModeTokenName, AnyDeclaredModeTokenDefinition>>;
}

/** Every Screen Mode that declares Mode Tokens, in Screen Mode order. */
export const THEMED_SCREEN_MODE_TOKENS: readonly ThemedScreenModeTokens[] = SCREEN_MODE_VALUES
	.filter(mode => SCREEN_MODES[mode].modeTokens)
	.map(mode => ({
		mode,
		label: SCREEN_MODES[mode].label,
		tokens: screenModeTokens(mode),
	}));

const MODE_TOKENS: Readonly<Record<string, AnyDeclaredModeTokenDefinition>> = Object.assign(
	{},
	...THEMED_SCREEN_MODE_TOKENS.map(({ tokens }) => tokens),
);

const FORMER_TOKENS: ReadonlySet<string> = new Set(SCREEN_MODE_VALUES.flatMap(screenModeFormerTokens));
for (const name of FORMER_TOKENS) {
	if (Object.hasOwn(MODE_TOKENS, name))
		throw new Error(`Theme Token "${name}" cannot be both a Mode Token and a former token of its mode.`);
}

/**
 * Whether `name` is a former token: one a Screen Mode declared once and no
 * longer does. A Theme or Screen Theme Override write naming one is accepted
 * and the token dropped, and a stored one is read by nothing.
 */
export function isFormerThemeToken(name: string): boolean {
	return FORMER_TOKENS.has(name);
}

export type ThemeTokenDefinitionOf
	= | { tier: 'foundation'; definition: FoundationTokenDefinition }
		| { tier: 'mode'; definition: AnyDeclaredModeTokenDefinition };

/** The Theme Token `name` names, with its tier, or undefined for a name no token has now. */
export function themeTokenDefinition(name: string): ThemeTokenDefinitionOf | undefined {
	if (Object.hasOwn(FOUNDATION_TOKENS, name))
		return { tier: 'foundation', definition: FOUNDATION_TOKENS[name as FoundationTokenName] };
	if (Object.hasOwn(MODE_TOKENS, name))
		return { tier: 'mode', definition: MODE_TOKENS[name]! };
	return undefined;
}

export type ThemeTokenWrite
	= | { ok: true; dropped?: false; value: ThemeTokenValue }
		| { ok: true; dropped: true }
		| { ok: false; refusal: ThemeTokenWriteRefusal };

/**
 * A value a Theme may store for `name`, or why not.
 *
 * Unlike a read, a write is not forgiving: a value of the wrong type or outside
 * its bounds is refused, never clamped. A stored value never names another
 * token: a Mode Token naming a Foundation Token, and a colour inside a fill,
 * surface or background layer naming one, are refused as any other invalid
 * value is. A former token is accepted whatever it is given and `dropped`:
 * there is nothing to store.
 */
export function parseThemeTokenWrite(name: string, value: unknown): ThemeTokenWrite {
	if (isFormerThemeToken(name))
		return { ok: true, dropped: true };
	const token = themeTokenDefinition(name);
	if (!token)
		return { ok: false, refusal: 'unknown-token' };

	const literal = themeTokenValueSchema(token.definition).safeParse(value);
	return literal.success
		? { ok: true, value: literal.data as ThemeTokenValue }
		: { ok: false, refusal: 'invalid-value' };
}
