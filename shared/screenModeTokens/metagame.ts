import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Metagame settings groups its Mode Tokens may name (ADR-0072). */
export type MetagameSettingsGroup = 'table';

/**
 * How the Metagame Screen Mode looks: its Mode Tokens, by name within the mode.
 * Every bar is named, so identity never rests on its colour alone.
 */
export const metagameModeTokens = {
	// How a row enters, leaves back to, and moves, each row an eighth of the
	// duration after the one above, and how a chart bar grows on its timing.
	// A recipe with no channel cuts.
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
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<MetagameSettingsGroup>>>;

/**
 * The Mode Tokens Metagame once declared: its chart slots, which only repeated
 * the `series-1` … `series-8` and `series-other` Foundation Tokens its chart now
 * reads directly, then its type and shared chrome, which did the same, and the
 * table and chart's max width, now its config's `maxWidth` (#1081).
 */
export const metagameFormerModeTokens = [
	'chart-series-1',
	'chart-series-2',
	'chart-series-3',
	'chart-series-4',
	'chart-series-5',
	'chart-series-6',
	'chart-series-7',
	'chart-series-8',
	'chart-other',
	'surface',
	'title-typography',
	'title-text',
	'title-divider',
	'row-typography',
	'row-divider',
	'primary-text',
	'secondary-text',
	'header-typography',
	'header-text',
	'header-divider',
	'chart-baseline',
	'max-width',
] as const;
