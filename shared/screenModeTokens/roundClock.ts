import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Round Clock settings groups its Mode Tokens may name (ADR-0072). */
export type RoundClockSettingsGroup = 'clock';

/** How the Round Clock Screen Mode looks: its Mode Tokens, by name within the mode. */
export const roundClockModeTokens = {
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

/**
 * The Mode Tokens Round Clock once declared: its type and shared chrome, which only
 * repeated the Foundation Tokens its display now reads directly.
 */
export const roundClockFormerModeTokens = [
	'surface',
	'round-name-typography',
	'round-name-text',
	'clock-typography',
] as const;
