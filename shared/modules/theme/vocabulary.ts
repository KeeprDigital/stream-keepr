import type { ThemeBackgroundLayer } from './background';
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
	// Text on a badge, pill or chip whose surface is `text-primary`, so a Theme
	// sets the two as a pair.
	'text-inverse': {
		type: 'color',
		label: 'Text on primary text',
		default: '#111827',
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
	'caution': {
		type: 'color',
		label: 'Caution',
		default: '#facc15',
	},
	'divider': {
		type: 'color',
		label: 'Divider',
		default: 'rgba(255, 255, 255, 0.12)',
	},
	'logo': {
		type: 'asset',
		label: 'Primary logo',
		assetKinds: ['image', 'silent-video'],
		// None: the Default Theme carries no production's branding.
		default: null,
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
	// What Graphic Items bind to (#829). A fill's or surface's colour names a
	// colour token, so it follows the palette.
	'accent-fill': {
		type: 'fill',
		label: 'Accent fill',
		default: {
			type: 'solid',
			color: { token: 'accent' },
		},
	},
	'panel': {
		type: 'surface-style',
		label: 'Panel',
		default: {
			fill: {
				type: 'solid',
				color: { token: 'accent' },
			},
			fillOpacity: 1,
		},
	},
	'panel-shape': {
		type: 'shape-geometry',
		label: 'Panel shape',
		default: {
			topLeft: { treatment: 'square', size: 0 },
			topRight: { treatment: 'square', size: 0 },
			bottomRight: { treatment: 'square', size: 0 },
			bottomLeft: { treatment: 'square', size: 0 },
			leftSlant: 0,
			rightSlant: 0,
		},
	},
	'motion-enter': {
		type: 'animation-recipe',
		label: 'Enter motion',
		default: {
			duration: 400,
			easing: 'ease-out',
			delay: 0,
			fade: { opacity: 0 },
		},
	},
	'motion-update': {
		type: 'animation-recipe',
		label: 'Update motion',
		default: {
			duration: 400,
			easing: 'ease-out',
			delay: 0,
			fade: { opacity: 0 },
		},
	},
	'motion-exit': {
		type: 'animation-recipe',
		label: 'Exit motion',
		default: {
			duration: 300,
			easing: 'ease-in',
			delay: 0,
			fade: { opacity: 0 },
		},
	},
	'inset': {
		type: 'dimension',
		label: 'Screen inset',
		default: 0,
		bounds: { min: 0, max: 480 },
	},
	'alignment': {
		type: 'alignment',
		label: 'Screen alignment',
		default: { horizontal: 'center', vertical: 'center' },
	},
	'background': {
		type: 'backgroundLayers',
		label: 'Background',
		// Empty: a Background Screen stays black and a plain mode clear.
		default: [] as ThemeBackgroundLayer[],
	},
	'animation-effect': {
		type: 'animationEffect',
		label: 'Animation Effect',
		default: { effect: 'fog' },
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
