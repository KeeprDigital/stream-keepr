import type { FoundationTokenDefinition, ThemeTokenValue } from './modules/theme/tokens';
import type { DeclaredModeTokenDefinition, FoundationTokenName } from './modules/theme/vocabulary';
import type { ScreenModeTokenName } from './screenModes';
import type { ScreenMode } from './types/enums';
import type { ThemeTokenWriteRefusal } from './types/theme';
import { z } from 'zod';
import { themeTokenValueSchema } from './modules/theme/tokens';
import { FOUNDATION_TOKENS } from './modules/theme/vocabulary';
import { SCREEN_MODES, screenModeTokens } from './screenModes';
import { SCREEN_MODE_VALUES } from './types/enums';

/**
 * The whole Theme Token vocabulary a Theme may set: every Foundation Token,
 * and every Mode Token a Screen Mode Definition declares. Stream Keepr owns
 * each name (ADR-0049).
 */

/** The Mode Tokens of one themed Screen Mode, by full name, as a Theme editor groups them. */
export interface ThemedScreenModeTokens {
	mode: ScreenMode;
	label: string;
	tokens: Readonly<Record<ScreenModeTokenName, DeclaredModeTokenDefinition>>;
}

/** Every Screen Mode that declares Mode Tokens, in Screen Mode order. */
export const THEMED_SCREEN_MODE_TOKENS: readonly ThemedScreenModeTokens[] = SCREEN_MODE_VALUES
	.filter(mode => SCREEN_MODES[mode].modeTokens)
	.map(mode => ({
		mode,
		label: SCREEN_MODES[mode].label,
		tokens: screenModeTokens(mode),
	}));

const MODE_TOKENS: Readonly<Record<string, DeclaredModeTokenDefinition>> = Object.assign(
	{},
	...THEMED_SCREEN_MODE_TOKENS.map(({ tokens }) => tokens),
);

export type ThemeTokenDefinitionOf
	= | { tier: 'foundation'; definition: FoundationTokenDefinition }
		| { tier: 'mode'; definition: DeclaredModeTokenDefinition };

/** The Theme Token `name` names, with its tier, or undefined for a name no token has. */
export function themeTokenDefinition(name: string): ThemeTokenDefinitionOf | undefined {
	if (Object.hasOwn(FOUNDATION_TOKENS, name))
		return { tier: 'foundation', definition: FOUNDATION_TOKENS[name as FoundationTokenName] };
	if (Object.hasOwn(MODE_TOKENS, name))
		return { tier: 'mode', definition: MODE_TOKENS[name]! };
	return undefined;
}

const referenceSchema = z.object({
	token: z.string(),
}).strict();

export type ThemeTokenWrite
	= | { ok: true; value: ThemeTokenValue | { token: string } }
		| { ok: false; refusal: ThemeTokenWriteRefusal };

/**
 * A value a Theme may store for `name`, or why not.
 *
 * Unlike a read, a write is not forgiving: a value of the wrong type or outside
 * its bounds is refused, never clamped. A Foundation Token holds a literal; a
 * Mode Token holds a literal or names a Foundation Token of its own type, and
 * nothing names a Mode Token, so resolution stays one step.
 */
export function parseThemeTokenWrite(name: string, value: unknown): ThemeTokenWrite {
	const token = themeTokenDefinition(name);
	if (!token)
		return { ok: false, refusal: 'unknown-token' };

	const { definition } = token;
	if (token.tier === 'mode') {
		const reference = referenceSchema.safeParse(value);
		if (reference.success) {
			const named = themeTokenDefinition(reference.data.token);
			return named?.tier === 'foundation' && named.definition.type === definition.type
				? { ok: true, value: reference.data }
				: { ok: false, refusal: 'invalid-value' };
		}
	}

	const literal = themeTokenValueSchema(definition).safeParse(value);
	return literal.success
		? { ok: true, value: literal.data as ThemeTokenValue }
		: { ok: false, refusal: 'invalid-value' };
}
