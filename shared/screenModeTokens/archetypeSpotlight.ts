import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';
import type { archetypeSpotlightModeConfigContract } from '../screenModeConfigs/archetypeSpotlight';
import type { ScreenSettingsGroupOf } from '../screenModeConfigs/contract';

/** The groups its Mode Tokens may name: the Screen Settings Groups its config contract declares (ADR-0072). */
export type ArchetypeSpotlightSettingsGroup = ScreenSettingsGroupOf<typeof archetypeSpotlightModeConfigContract>;

/** How the Archetype Spotlight Screen Mode looks: its Mode Tokens, by name within the mode. */
export const archetypeSpotlightModeTokens = {
	// As Most Played Cards' stat badge, so an inclusion rate reads the same on both Screens.
	'stat-badge-surface': {
		type: 'color',
		label: 'Card stat badge surface',
		settingsGroup: 'top-cards',
		default: { token: 'text-primary' },
	},
	'stat-badge-text': {
		type: 'color',
		label: 'Card stat badge text',
		settingsGroup: 'top-cards',
		default: { token: 'text-inverse' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<ArchetypeSpotlightSettingsGroup>>>;

/**
 * The Mode Tokens Archetype Spotlight once declared: its type, shared chrome, placeholder
 * surface and badge shadow, which only repeated the Foundation Tokens its display now
 * reads directly.
 */
export const archetypeSpotlightFormerModeTokens = [
	'title-typography',
	'title-text',
	'title-divider',
	'headline-typography',
	'label-typography',
	'surface',
	'row-typography',
	'row-divider',
	'primary-text',
	'secondary-text',
	'card-placeholder-surface',
	'badge-shadow',
] as const;
