import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import type { cardModeConfigContract } from '../screenModeConfigs/card';
import type { ScreenSettingsGroupOf } from '../screenModeConfigs/contract';

/** The groups its Mode Tokens may name: the Screen Settings Groups its config contract declares (ADR-0072). */
export type CardSettingsGroup = ScreenSettingsGroupOf<typeof cardModeConfigContract>;

/** How the Card Spotlight Screen Mode looks: its Mode Tokens, by name within the mode. */
export const cardModeTokens = {
	// How the card enters and, reversed, leaves: the zoom and fade it shipped with.
	// A recipe with no channel cuts. Its quicker pace matches no Foundation
	// motion, so it keeps its own.
	motion: {
		type: 'animation-recipe',
		label: 'Card enter and exit',
		settingsGroup: 'card',
		default: {
			duration: 200,
			easing: 'ease-in-out',
			delay: 0,
			fade: { opacity: 0 },
			scale: { factor: 0.7, origin: 'center' },
		},
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<CardSettingsGroup>>>;
