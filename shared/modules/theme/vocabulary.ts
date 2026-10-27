import type {
	FoundationTokenVocabulary,
	ModeTokenValue,
	StoredThemeTokens,
	ThemeTokenType,
	TokenDefinitionOf,
} from './tokens';

/**
 * Every Foundation Token, owned by Stream Keepr and versioned with the code:
 * its name, type, bounds and shipped default. Users set values, never names
 * (ADR-0049).
 *
 * A rename or removal follows the Screen Mode key and config rules (ADR-0043,
 * ADR-0037): a former token still stored is dropped when read, and a stored
 * value outside a tightened bound reads as the nearest bound
 * (`resolveThemeTokens`).
 *
 * The defaults are the Default Theme's look, an Event with no Theme. They keep
 * the broadcast look Screens had before Themes, as one palette: a mode's rules
 * share one divider, and its secondary text is a colour, not an opacity.
 */
export const FOUNDATION_TOKENS = {
	'surface': {
		type: 'color',
		label: 'Surface',
		// Clear, so the Screen's background shows through.
		default: 'rgba(0, 0, 0, 0)',
	},
	'surface-raised': {
		type: 'color',
		label: 'Raised surface',
		default: 'rgba(255, 255, 255, 0.06)',
	},
	'text-primary': {
		type: 'color',
		label: 'Primary text',
		default: '#ffffff',
	},
	'text-secondary': {
		type: 'color',
		label: 'Secondary text',
		default: 'rgba(255, 255, 255, 0.72)',
	},
	'accent': {
		type: 'color',
		label: 'Accent',
		default: '#0077a3',
	},
	'positive': {
		type: 'color',
		label: 'Positive',
		default: '#4ade80',
	},
	'negative': {
		type: 'color',
		label: 'Negative',
		default: '#f87171',
	},
	'divider': {
		type: 'color',
		label: 'Divider',
		default: 'rgba(255, 255, 255, 0.12)',
	},
	'heading': {
		type: 'typography',
		label: 'Heading',
		default: {
			font: { kind: 'application', fontId: 'saira-condensed' },
			weight: 800,
			lineHeight: 1,
			tracking: 0.06,
			case: 'uppercase',
		},
	},
	'body': {
		type: 'typography',
		label: 'Body',
		default: {
			font: { kind: 'application', fontId: 'saira-condensed' },
			weight: 500,
			lineHeight: 1.1,
			tracking: 0.01,
			case: 'none',
		},
	},
	'inset': {
		type: 'dimension',
		label: 'Screen inset',
		default: 0,
		bounds: { min: 0, max: 480 },
	},
} as const satisfies FoundationTokenVocabulary;

export type FoundationTokenName = keyof typeof FOUNDATION_TOKENS;

/** The Foundation Tokens of one type, which a Mode Token of that type may name. */
export type FoundationTokenNameOfType<T extends ThemeTokenType> = {
	[N in FoundationTokenName]: typeof FOUNDATION_TOKENS[N]['type'] extends T ? N : never;
}[FoundationTokenName];

/**
 * A Mode Token as a Screen Mode Definition declares it: its default names a
 * Foundation Token of its own type, checked against the vocabulary, or holds
 * a literal.
 */
export type DeclaredModeTokenDefinition = {
	[T in ThemeTokenType]: TokenDefinitionOf<T, ModeTokenValue<T, FoundationTokenNameOfType<T>>>;
}[ThemeTokenType];

/**
 * The Default Theme's stored values: none, so every token reads its shipped
 * default. It is code, never a stored Theme, and cannot be edited or deleted.
 */
export const DEFAULT_THEME_TOKENS: StoredThemeTokens = Object.freeze({});
