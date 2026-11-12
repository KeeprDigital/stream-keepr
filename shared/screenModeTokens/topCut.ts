import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import type { ScreenSettingsGroupOf } from '../screenModeConfigs/contract';
import type { topCutModeConfigContract } from '../screenModeConfigs/topCut';

/** The groups its Mode Tokens may name: the Screen Settings Groups its config contract declares (ADR-0072). */
export type TopCutSettingsGroup = ScreenSettingsGroupOf<typeof topCutModeConfigContract>;

/** How the Top Cut Bracket Screen Mode looks: its Mode Tokens, by name within the mode. */
export const topCutModeTokens = {
	'position-surface': {
		type: 'color',
		label: 'Bracket Position surface',
		settingsGroup: 'bracket',
		default: { token: 'surface-raised' },
	},
	'pending-position-border': {
		type: 'color',
		label: 'Pending Bracket Position border',
		settingsGroup: 'bracket',
		default: { token: 'divider' },
	},
	'winner-surface': {
		type: 'color',
		label: 'Winner surface',
		settingsGroup: 'bracket',
		default: { token: 'accent' },
	},
	'connector': {
		type: 'color',
		label: 'Bracket connector',
		settingsGroup: 'bracket',
		default: { token: 'divider' },
	},
	'champion-border': {
		type: 'color',
		label: 'Champion border',
		settingsGroup: 'champion',
		default: { token: 'accent' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<TopCutSettingsGroup>>>;

/**
 * The Mode Tokens Top Cut Bracket once declared: its type and shared chrome, with
 * a settled Bracket Position's border and the rule between its entrants, which
 * only repeated the Foundation Tokens its display now reads directly.
 */
export const topCutFormerModeTokens = [
	'title-typography',
	'title-text',
	'title-divider',
	'round-name-typography',
	'round-name-text',
	'entrant-typography',
	'primary-text',
	'secondary-text',
	'position-border',
	'entrant-divider',
	'champion-typography',
] as const;
