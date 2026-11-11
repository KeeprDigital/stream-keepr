import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import type { ScreenSettingsGroupOf } from '../screenModeConfigs/contract';
import type { standingsModeConfigContract } from '../screenModeConfigs/standings';
import { rowMotionModeToken } from './rowMotion';

/** The groups its Mode Tokens may name: the Screen Settings Groups its config contract declares (ADR-0072). */
export type StandingsSettingsGroup = ScreenSettingsGroupOf<typeof standingsModeConfigContract>;

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
	// The row motion Metagame shares.
	'row-motion': rowMotionModeToken,
	// The `reveal` view mode's rows, in place of `row-motion`: a slower rise for
	// the reveal. Its pace matches no Foundation motion, so it keeps its own.
	'reveal-motion': {
		type: 'animation-recipe',
		label: 'Revealed row enter and exit',
		settingsGroup: 'reveal',
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
