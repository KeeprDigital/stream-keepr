import type {
	FoundationTokenVocabulary,
	ModeTokenDeclarations,
	ModeTokenDefinition,
	StoredThemeTokens,
	ThemeTokenReference,
	ThemeTokenValue,
} from './tokens';
import { readTokenLiteral } from './tokens';

export interface ResolveThemeTokensInput {
	/** Every Foundation Token: its type, bounds and shipped default. */
	vocabulary: FoundationTokenVocabulary;
	/** The Screen Mode's declared Mode Tokens, by full name. */
	modeTokens: ModeTokenDeclarations;
	/** The Event's Theme's stored values; the Default Theme stores none. */
	theme: StoredThemeTokens;
	/** The Screen's Screen Theme Overrides. */
	overrides: StoredThemeTokens;
}

export interface ResolvedThemeTokens {
	/** Each consumed token's resolved value, by name. */
	values: Readonly<Record<string, ThemeTokenValue>>;
	/**
	 * The tokens the Screen consumes: every Mode Token its mode declares, then
	 * each Foundation Token one of them resolves through, in vocabulary order.
	 */
	consumed: readonly string[];
}

function isReference(value: unknown): value is ThemeTokenReference {
	return typeof value === 'object'
		&& value !== null
		&& Object.keys(value).length === 1
		&& typeof (value as { token?: unknown }).token === 'string';
}

/**
 * Resolves a Screen's Theme Tokens: the single home of every resolution rule
 * (ADR-0049).
 *
 * - Each token reads from the Screen Theme Override, else the Theme, else its
 *   shipped default.
 * - A Mode Token naming a Foundation Token reads that Foundation Token by the
 *   same precedence, so a Foundation override reaches every Mode Token naming
 *   it. Foundation Tokens hold literals only and nothing names a Mode Token,
 *   so this is one step and cannot cycle.
 * - A stored value is read, never trusted: a token no longer in the vocabulary
 *   (a former token) is dropped, a number outside a tightened bound reads as
 *   the nearest bound, and a value of the wrong type, or naming no same-type
 *   Foundation Token, is ignored in favour of the next source.
 * - An override of a Mode Token another mode declares stays dormant: only
 *   this mode's Mode Tokens are read.
 */
export function resolveThemeTokens(input: ResolveThemeTokensInput): ResolvedThemeTokens {
	const { vocabulary, modeTokens, theme, overrides } = input;
	const sources = [overrides, theme];
	const foundationValues = new Map<string, ThemeTokenValue>();

	function resolveFoundation(name: string): ThemeTokenValue {
		const cached = foundationValues.get(name);
		if (cached !== undefined)
			return cached;
		const definition = vocabulary[name]!;
		let value: ThemeTokenValue = definition.default;
		for (const source of sources) {
			const stored = readTokenLiteral(definition, source[name]);
			if (stored !== undefined) {
				value = stored;
				break;
			}
		}
		foundationValues.set(name, value);
		return value;
	}

	/** A Mode Token's value as one source holds it, or undefined when it holds none it can read. */
	function readModeToken(definition: ModeTokenDefinition, stored: unknown): ThemeTokenValue | undefined {
		if (!isReference(stored))
			return readTokenLiteral(definition, stored);
		if (vocabulary[stored.token]?.type !== definition.type)
			return undefined;
		// Read within the Mode Token's own bounds too, where it declares tighter ones.
		return readTokenLiteral(definition, resolveFoundation(stored.token));
	}

	const values: Record<string, ThemeTokenValue> = {};
	for (const [name, definition] of Object.entries(modeTokens)) {
		for (const stored of [overrides[name], theme[name], definition.default]) {
			const value = readModeToken(definition, stored);
			if (value !== undefined) {
				values[name] = value;
				break;
			}
		}
	}

	const consumedFoundation = Object.keys(vocabulary).filter(name => foundationValues.has(name));
	for (const name of consumedFoundation)
		values[name] = foundationValues.get(name)!;

	return {
		values,
		consumed: [
			...Object.keys(modeTokens),
			...consumedFoundation,
		],
	};
}
