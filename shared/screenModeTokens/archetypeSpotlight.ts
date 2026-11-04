import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Archetype Spotlight settings groups its Mode Tokens may name (ADR-0071). */
export type ArchetypeSpotlightSettingsGroup = 'header' | 'data' | 'top-cards' | 'pilots';

/** How the Archetype Spotlight Screen Mode looks: its Mode Tokens, by name within the mode. */
export const archetypeSpotlightModeTokens = {
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
	'headline-typography': {
		type: 'typography',
		label: 'Archetype name and stat type',
		settingsGroup: 'data',
		default: { token: 'heading' },
	},
	'label-typography': {
		type: 'typography',
		label: 'Stat and column label type',
		settingsGroup: 'data',
		default: { token: 'heading' },
	},
	'surface': {
		type: 'color',
		label: 'Pilot table surface',
		settingsGroup: 'pilots',
		default: { token: 'surface' },
	},
	'row-typography': {
		type: 'typography',
		label: 'Row type',
		settingsGroup: 'pilots',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		settingsGroup: 'pilots',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Name, stat and record text',
		settingsGroup: 'data',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Label, position and page text',
		settingsGroup: 'data',
		default: { token: 'text-secondary' },
	},
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
	// As Most Played Cards' card face and badge shadow, which its cards share.
	'card-placeholder-surface': {
		type: 'color',
		label: 'Card without an image',
		settingsGroup: 'top-cards',
		default: { token: 'surface-raised' },
	},
	'badge-shadow': {
		type: 'color',
		label: 'Card stat badge shadow',
		settingsGroup: 'top-cards',
		default: { token: 'shadow' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<ArchetypeSpotlightSettingsGroup>>>;
