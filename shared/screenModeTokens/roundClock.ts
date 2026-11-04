import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Round Clock Screen Mode looks: its Mode Tokens, by name within the mode. */
export const roundClockModeTokens = {
	'surface': {
		type: 'color',
		label: 'Clock surface',
		default: { token: 'surface' },
	},
	'round-name-typography': {
		type: 'typography',
		label: 'Round name type',
		default: { token: 'heading' },
	},
	'round-name-text': {
		type: 'color',
		label: 'Round name text',
		default: { token: 'text-secondary' },
	},
	'clock-typography': {
		type: 'typography',
		label: 'Clock type',
		default: { token: 'heading' },
	},
	'running-clock-text': {
		type: 'color',
		label: 'Running clock text',
		default: { token: 'text-primary' },
	},
	'pending-clock-text': {
		type: 'color',
		label: 'Clock text before the start',
		default: { token: 'text-secondary' },
	},
	'ended-clock-text': {
		type: 'color',
		label: 'Clock text after the end',
		default: { token: 'caution' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
