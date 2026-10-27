import type {
	FoundationTokenDefinition,
	FoundationTokenVocabulary,
	ModeTokenDeclarations,
	ModeTokenDefinition,
	StoredThemeTokens,
	ThemeTokenReference,
	ThemeTokenValue,
} from './tokens';
import { resolveThemeCompositeColors } from './composites';
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
	 * The tokens the Screen consumes, from its mode's declaration alone: every
	 * Mode Token it declares, then each Foundation Token their defaults name,
	 * in vocabulary order. What a Theme or override stores never changes it.
	 */
	consumed: readonly string[];
}

function isReference(value: unknown): value is ThemeTokenReference {
	return typeof value === 'object'
		&& value !== null
		&& Object.keys(value).length === 1
		&& typeof (value as { token?: unknown }).token === 'string';
}

/** The first of `stored`, most preferred first, that `read` can read. */
function firstReadable(stored: readonly unknown[], read: (value: unknown) => ThemeTokenValue | undefined): ThemeTokenValue | undefined {
	for (const value of stored) {
		const readable = read(value);
		if (readable !== undefined)
			return readable;
	}
	return undefined;
}

/**
 * How one Screen reads Foundation Tokens: override, else Theme, else default.
 * A colour inside a composite literal (a fill or a surface) is read the same
 * way, so a colour override reaches every composite naming it. A colour holds
 * a literal only, so this adds at most one step and cannot cycle.
 */
function foundationResolver({ vocabulary, theme, overrides }: Omit<ResolveThemeTokensInput, 'modeTokens'>) {
	function resolveColor(name: string): string | undefined {
		return vocabulary[name]?.type === 'color'
			? resolveFoundation(name) as string
			: undefined;
	}

	/** A literal as `definition`'s type, its colours resolved, or undefined when it is not one. */
	function readLiteral(definition: FoundationTokenDefinition | ModeTokenDefinition, stored: unknown): ThemeTokenValue | undefined {
		const literal = readTokenLiteral(definition, stored);
		return literal === undefined
			? undefined
			: resolveThemeCompositeColors(definition.type, literal, resolveColor);
	}

	function resolveFoundation(name: string): ThemeTokenValue {
		const definition = vocabulary[name]!;
		return firstReadable([overrides[name], theme[name], definition.default], stored => readLiteral(definition, stored))!;
	}

	return { resolveFoundation, readLiteral };
}

/**
 * Every Foundation Token a Screen resolves, by name. A graphics host's Graphic
 * Items bind to these, since any of them may name any Foundation Token of its
 * type. Resolved by the same rules as `resolveThemeTokens`.
 */
export function resolveFoundationTokens(input: Omit<ResolveThemeTokensInput, 'modeTokens'>): Readonly<Record<string, ThemeTokenValue>> {
	const { resolveFoundation } = foundationResolver(input);
	return Object.fromEntries(Object.keys(input.vocabulary).map(name => [
		name,
		resolveFoundation(name),
	]));
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
 *   so this is one step and cannot cycle; a colour a composite names adds
 *   one more (`foundationResolver`).
 * - A stored value is read, never trusted: a token no longer in the vocabulary
 *   (a former token) is dropped, a number outside a tightened bound reads as
 *   the nearest bound, and a value of the wrong type, or naming no same-type
 *   Foundation Token, is ignored in favour of the next source.
 * - An override of a Mode Token another mode declares stays dormant: only
 *   this mode's Mode Tokens are read.
 */
export function resolveThemeTokens(input: ResolveThemeTokensInput): ResolvedThemeTokens {
	const { vocabulary, modeTokens, theme, overrides } = input;
	const { resolveFoundation, readLiteral } = foundationResolver(input);

	/** A Mode Token's value as one source holds it, or undefined when it holds none it can read. */
	function readModeToken(definition: ModeTokenDefinition, stored: unknown): ThemeTokenValue | undefined {
		if (!isReference(stored))
			return readLiteral(definition, stored);
		if (vocabulary[stored.token]?.type !== definition.type)
			return undefined;
		// Read within the Mode Token's own bounds too, where it declares tighter ones.
		return readTokenLiteral(definition, resolveFoundation(stored.token));
	}

	const values: Record<string, ThemeTokenValue> = {};
	for (const [name, definition] of Object.entries(modeTokens))
		values[name] = firstReadable([overrides[name], theme[name], definition.default], stored => readModeToken(definition, stored))!;

	const namedByDefaults = new Set(Object.values(modeTokens).flatMap(({ default: fallback }) => isReference(fallback)
		? [fallback.token]
		: []));
	const consumedFoundation = Object.keys(vocabulary).filter(name => namedByDefaults.has(name));
	for (const name of consumedFoundation)
		values[name] = resolveFoundation(name);

	return {
		values,
		consumed: [
			...Object.keys(modeTokens),
			...consumedFoundation,
		],
	};
}
