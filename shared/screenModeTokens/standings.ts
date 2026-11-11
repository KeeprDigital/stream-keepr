import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Standings settings groups its Mode Tokens may name (ADR-0072). */
export type StandingsSettingsGroup = 'data' | 'table';

/** How the Standings Screen Mode looks: its Mode Tokens, by name within the mode. */
export const standingsModeTokens = {
	'rise': {
		type: 'color',
		label: 'Position Change climb',
		settingsGroup: 'table',
		default: { token: 'positive' },
	},
	'fall': {
		type: 'color',
		label: 'Position Change drop',
		settingsGroup: 'table',
		default: { token: 'negative' },
	},
	// How a row enters, leaves back to, and moves, each row an eighth of the
	// duration after the one above. A recipe with no channel cuts.
	'row-motion': {
		type: 'animation-recipe',
		label: 'Row enter and exit',
		settingsGroup: 'table',
		default: {
			duration: 400,
			easing: 'ease-out',
			delay: 0,
			fade: { opacity: 0 },
			slide: { direction: 'west', distanceMode: 'fixed', distance: 20 },
		},
	},
	// The `reveal` view mode's rows, in place of `row-motion`: a rise for the reveal.
	'reveal-motion': {
		type: 'animation-recipe',
		label: 'Revealed row enter and exit',
		settingsGroup: 'data',
		default: {
			duration: 600,
			easing: 'ease-out',
			delay: 0,
			fade: { opacity: 0 },
			slide: { direction: 'south', distanceMode: 'fixed', distance: 20 },
			scale: { factor: 0.95, origin: 'center' },
		},
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<StandingsSettingsGroup>>>;

/**
 * The Mode Tokens Standings once declared: its type and shared chrome, which only
 * repeated the Foundation Tokens its display now reads directly, and the table's
 * max width, now its config's `maxWidth` (#1081).
 */
export const standingsFormerModeTokens = [
	'surface',
	'title-typography',
	'title-text',
	'title-divider',
	'row-typography',
	'row-divider',
	'primary-text',
	'secondary-text',
	'max-width',
] as const;
