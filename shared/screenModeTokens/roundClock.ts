import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Round Clock settings groups its Mode Tokens may name (ADR-0071). */
export type RoundClockSettingsGroup = 'round-name' | 'clock';

/** How the Round Clock Screen Mode looks: its Mode Tokens, by name within the mode. */
export const roundClockModeTokens = {
	'surface': {
		type: 'color',
		label: 'Clock surface',
		settingsGroup: 'clock',
		default: { token: 'surface' },
	},
	'round-name-typography': {
		type: 'typography',
		label: 'Round name type',
		settingsGroup: 'round-name',
		default: { token: 'heading' },
	},
	'round-name-text': {
		type: 'color',
		label: 'Round name text',
		settingsGroup: 'round-name',
		default: { token: 'text-secondary' },
	},
	'clock-typography': {
		type: 'typography',
		label: 'Clock type',
		settingsGroup: 'clock',
		default: { token: 'heading' },
	},
	'running-clock-text': {
		type: 'color',
		label: 'Running clock text',
		settingsGroup: 'clock',
		default: { token: 'text-primary' },
	},
	'pending-clock-text': {
		type: 'color',
		label: 'Clock text before the start',
		settingsGroup: 'clock',
		default: { token: 'text-secondary' },
	},
	'ended-clock-text': {
		type: 'color',
		label: 'Clock text after the end',
		settingsGroup: 'clock',
		default: { token: 'caution' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<RoundClockSettingsGroup>>>;
