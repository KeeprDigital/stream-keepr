import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Pairings settings groups its Mode Tokens may name (ADR-0072). */
export type PairingsSettingsGroup = 'result-badge';

/** How the Pairings Screen Mode looks: its Mode Tokens, by name within the mode. */
export const pairingsModeTokens = {
	'result-reported': {
		type: 'color',
		label: 'Reported result',
		settingsGroup: 'result-badge',
		default: { token: 'positive' },
	},
	'result-pending': {
		type: 'color',
		label: 'Pending result',
		settingsGroup: 'result-badge',
		default: { token: 'text-secondary' },
	},
	'result-bye': {
		type: 'color',
		label: 'Bye result',
		settingsGroup: 'result-badge',
		default: { token: 'caution' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<PairingsSettingsGroup>>>;

/**
 * The Mode Tokens Pairings once declared: its type and shared chrome, which only
 * repeated the Foundation Tokens its display now reads directly.
 */
export const pairingsFormerModeTokens = [
	'surface',
	'title-typography',
	'title-text',
	'title-divider',
	'row-typography',
	'row-divider',
	'primary-text',
	'secondary-text',
	'result-typography',
] as const;
