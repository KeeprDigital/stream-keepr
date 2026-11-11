import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Player History settings groups its Mode Tokens may name (ADR-0072). */
export type PlayerHistorySettingsGroup = 'outcome-badge';

/** How the Player History Screen Mode looks: its Mode Tokens, by name within the mode. */
export const playerHistoryModeTokens = {
	'outcome-win': {
		type: 'color',
		label: 'Win or bye outcome',
		settingsGroup: 'outcome-badge',
		default: { token: 'positive' },
	},
	'outcome-loss': {
		type: 'color',
		label: 'Loss outcome',
		settingsGroup: 'outcome-badge',
		default: { token: 'negative' },
	},
	'outcome-draw': {
		type: 'color',
		label: 'Draw outcome',
		settingsGroup: 'outcome-badge',
		default: { token: 'caution' },
	},
	'outcome-pending': {
		type: 'color',
		label: 'Pending outcome',
		settingsGroup: 'outcome-badge',
		default: { token: 'text-secondary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<PlayerHistorySettingsGroup>>>;

/**
 * The Mode Tokens Player History once declared: its type and shared chrome, which only
 * repeated the Foundation Tokens its display now reads directly.
 */
export const playerHistoryFormerModeTokens = [
	'surface',
	'title-typography',
	'title-text',
	'title-divider',
	'row-typography',
	'row-divider',
	'primary-text',
	'secondary-text',
	'outcome-typography',
] as const;
