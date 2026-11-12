import type { GraphicAnimationRecipe } from '../../types/graphics';
import type {
	FoundationTokenDefinition,
	FoundationTokenVocabulary,
	ModeTokenDeclarations,
	ModeTokenDefinition,
	StoredThemeTokens,
	ThemeMotionFollow,
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
	/** The Event's Theme's stored values; the Default Theme stores none. Only its Foundation Tokens are read. */
	theme: StoredThemeTokens;
	/** The Screen's Screen Theme Overrides. Only its Mode Tokens and host tokens are read. */
	overrides: StoredThemeTokens;
	/**
	 * Foundation Tokens the Screen's host consumes itself rather than through a
	 * Mode Token, such as a plain mode's `inset` and `alignment`: the only
	 * Foundation Tokens a Screen may override. None when left out.
	 */
	hostTokens?: readonly string[];
}

export interface ResolvedThemeTokens {
	/**
	 * Each token the Screen consumes, resolved, by name: every Mode Token its
	 * mode declares, then each Foundation Token their defaults name or its host
	 * consumes, in vocabulary order. Which tokens it holds follows the mode's
	 * declaration alone; what a Theme or override stores never changes it.
	 */
	values: Readonly<Record<string, ThemeTokenValue>>;
}

function isReference(value: unknown): value is ThemeTokenReference {
	return typeof value === 'object'
		&& value !== null
		&& Object.keys(value).length === 1
		&& typeof (value as { token?: unknown }).token === 'string';
}

function isMotionFollow(value: unknown): value is ThemeMotionFollow {
	return typeof value === 'object'
		&& value !== null
		&& Object.keys(value).length === 2
		&& typeof (value as { token?: unknown }).token === 'string'
		&& typeof (value as { movement?: unknown }).movement === 'object';
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
 * How one Screen reads Foundation Tokens: Theme, else default, and over both
 * the Screen's override of a token its host consumes itself. Any other
 * Foundation override is dormant. A colour a composite default names (a fill's
 * or a surface's) is read the same way. A colour holds a literal only, so this
 * adds at most one step and cannot cycle.
 */
function foundationResolver({ vocabulary, theme, overrides, hostTokens = [] }: Omit<ResolveThemeTokensInput, 'modeTokens'>) {
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
		const override = hostTokens.includes(name)
			? overrides[name]
			: undefined;
		return firstReadable([override, theme[name], definition.default], stored => readLiteral(definition, stored))!;
	}

	return { resolveFoundation, readLiteral };
}

/**
 * Every Foundation Token a Screen resolves, by name. A graphics host's Graphic
 * Items bind to these, since any of them may name any Foundation Token of its
 * type. Resolved by the same rules as `resolveThemeTokens`, so from the Theme
 * alone but for the host tokens named.
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
 * - A Mode Token reads from the Screen Theme Override, else its shipped
 *   default: a Theme stores Foundation Tokens only, and a Mode Token one stored
 *   before is never read. A Foundation Token reads from the Theme, else its
 *   default; only one the Screen's host consumes itself (`hostTokens`) reads
 *   the override first.
 * - A stored value is a literal, read in one step. A default may name a
 *   Foundation Token, read by the same precedence. Nothing names a Mode Token, so this is one
 *   derivation and cannot cycle; a colour a composite default names adds one
 *   more (`foundationResolver`).
 * - A motion default may instead follow a motion Foundation Token: the same
 *   derivation for its timing, its movement its own (`ThemeMotionFollow`).
 *   The Screen consumes the Foundation Token it follows, as one a default
 *   names.
 * - A value stored before writes were literal-only may name a Foundation Token
 *   as a default does, whole or as a composite's colour. It reads the same
 *   way, to its literal, until its token is next written.
 * - A stored value is read, never trusted: a token no longer in the vocabulary
 *   (a former token) is dropped, a number outside a tightened bound reads as
 *   the nearest bound, and a value of the wrong type, or naming no same-type
 *   Foundation Token, is ignored in favour of the next source.
 * - An override of a Mode Token another mode declares, or of a Foundation
 *   Token the host does not consume itself, stays dormant: nothing reads it.
 */
export function resolveThemeTokens(input: ResolveThemeTokensInput): ResolvedThemeTokens {
	const { vocabulary, modeTokens, overrides, hostTokens = [] } = input;
	const { resolveFoundation, readLiteral } = foundationResolver(input);

	/** A Mode Token's value as one source holds it, or undefined when it holds none it can read. */
	function readModeToken(definition: ModeTokenDefinition, stored: unknown): ThemeTokenValue | undefined {
		if (isMotionFollow(stored)) {
			const followed = readModeToken(definition, { token: stored.token }) as GraphicAnimationRecipe | undefined;
			return followed && readLiteral(definition, {
				duration: followed.duration,
				easing: followed.easing,
				delay: followed.delay,
				...stored.movement,
			});
		}
		if (!isReference(stored))
			return readLiteral(definition, stored);
		if (vocabulary[stored.token]?.type !== definition.type)
			return undefined;
		// Read within the Mode Token's own bounds too, where it declares tighter ones.
		return readTokenLiteral(definition, resolveFoundation(stored.token));
	}

	const values: Record<string, ThemeTokenValue> = {};
	for (const [name, definition] of Object.entries(modeTokens))
		values[name] = firstReadable([overrides[name], definition.default], stored => readModeToken(definition, stored))!;

	const namedByDefaults = new Set([
		...Object.values(modeTokens).flatMap(({ default: fallback }) => isReference(fallback) || isMotionFollow(fallback)
			? [fallback.token]
			: []),
		...hostTokens,
	]);
	const consumedFoundation = Object.keys(vocabulary).filter(name => namedByDefaults.has(name));
	for (const name of consumedFoundation)
		values[name] = resolveFoundation(name);

	return { values };
}

/**
 * One Foundation Token, such as the `background` stack a Screen paints where
 * it holds none of its own, read as `resolveThemeTokens` reads every
 * Foundation Token.
 */
export function resolveFoundationToken(input: Omit<ResolveThemeTokensInput, 'modeTokens'>, name: string): ThemeTokenValue {
	return foundationResolver(input).resolveFoundation(name);
}
