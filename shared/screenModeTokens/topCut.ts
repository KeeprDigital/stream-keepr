import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Top Cut Bracket settings groups its Mode Tokens may name (ADR-0072). */
export type TopCutSettingsGroup = 'header' | 'entrants' | 'bracket' | 'champion';

/** How the Top Cut Bracket Screen Mode looks: its Mode Tokens, by name within the mode. */
export const topCutModeTokens = {
	'title-typography': {
		type: 'typography',
		label: 'Title type',
		settingsGroup: 'header',
		default: { token: 'heading' },
	},
	'title-text': {
		type: 'color',
		label: 'Title text',
		settingsGroup: 'header',
		default: { token: 'text-primary' },
	},
	'title-divider': {
		type: 'color',
		label: 'Title divider',
		settingsGroup: 'header',
		default: { token: 'divider' },
	},
	'round-name-typography': {
		type: 'typography',
		label: 'Round name type',
		settingsGroup: 'bracket',
		default: { token: 'heading' },
	},
	'round-name-text': {
		type: 'color',
		label: 'Round name text',
		settingsGroup: 'bracket',
		default: { token: 'text-secondary' },
	},
	'entrant-typography': {
		type: 'typography',
		label: 'Entrant type',
		settingsGroup: 'entrants',
		default: { token: 'body' },
	},
	'primary-text': {
		type: 'color',
		label: 'Name and score text',
		settingsGroup: 'entrants',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Seed, Archetype and eliminated text',
		settingsGroup: 'entrants',
		default: { token: 'text-secondary' },
	},
	'position-surface': {
		type: 'color',
		label: 'Bracket Position surface',
		settingsGroup: 'bracket',
		default: { token: 'surface-raised' },
	},
	'position-border': {
		type: 'color',
		label: 'Bracket Position border',
		settingsGroup: 'bracket',
		default: { token: 'divider' },
	},
	'pending-position-border': {
		type: 'color',
		label: 'Pending Bracket Position border',
		settingsGroup: 'bracket',
		default: { token: 'divider' },
	},
	'entrant-divider': {
		type: 'color',
		label: 'Entrant divider',
		settingsGroup: 'entrants',
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
	'champion-typography': {
		type: 'typography',
		label: 'Champion type',
		settingsGroup: 'champion',
		default: { token: 'heading' },
	},
	'champion-border': {
		type: 'color',
		label: 'Champion border',
		settingsGroup: 'champion',
		default: { token: 'accent' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<TopCutSettingsGroup>>>;
