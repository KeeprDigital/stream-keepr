import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Archetype Spotlight Screen Mode looks: its Mode Tokens, by name within the mode. */
export const archetypeSpotlightModeTokens = {
	'title-typography': {
		type: 'typography',
		label: 'Title type',
		default: { token: 'heading' },
	},
	'title-text': {
		type: 'color',
		label: 'Title text',
		default: { token: 'text-primary' },
	},
	'title-divider': {
		type: 'color',
		label: 'Title divider',
		default: { token: 'divider' },
	},
	'headline-typography': {
		type: 'typography',
		label: 'Archetype name and stat type',
		default: { token: 'heading' },
	},
	'label-typography': {
		type: 'typography',
		label: 'Stat and column label type',
		default: { token: 'heading' },
	},
	'surface': {
		type: 'color',
		label: 'Pilot table surface',
		default: { token: 'surface' },
	},
	'row-typography': {
		type: 'typography',
		label: 'Row type',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Name, stat and record text',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Label, position and page text',
		default: { token: 'text-secondary' },
	},
	// As Most Played Cards' stat badge, so an inclusion rate reads the same on both Screens.
	'stat-badge-surface': {
		type: 'color',
		label: 'Card stat badge surface',
		default: { token: 'text-primary' },
	},
	'stat-badge-text': {
		type: 'color',
		label: 'Card stat badge text',
		default: { token: 'text-inverse' },
	},
	// As Most Played Cards' card face and badge shadow, which its cards share.
	'card-placeholder-surface': {
		type: 'color',
		label: 'Card without an image',
		default: { token: 'surface-raised' },
	},
	'badge-shadow': {
		type: 'color',
		label: 'Card stat badge shadow',
		default: { token: 'shadow' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
