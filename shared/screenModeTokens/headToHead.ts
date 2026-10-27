import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Head-to-Head Screen Mode looks: its Mode Tokens, by name within the mode. */
export const headToHeadModeTokens = {
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
	'name-typography': {
		type: 'typography',
		label: 'Player name type',
		default: { token: 'heading' },
	},
	'label-typography': {
		type: 'typography',
		label: 'Versus, first meeting and list title type',
		default: { token: 'heading' },
	},
	'surface': {
		type: 'color',
		label: 'Earlier Matches surface',
		default: { token: 'surface' },
	},
	'row-typography': {
		type: 'typography',
		label: 'Player detail and row type',
		default: { token: 'body' },
	},
	'row-divider': {
		type: 'color',
		label: 'Row divider',
		default: { token: 'divider' },
	},
	'primary-text': {
		type: 'color',
		label: 'Name, deck and winner text',
		default: { token: 'text-primary' },
	},
	'secondary-text': {
		type: 'color',
		label: 'Pronouns, stats, Round and label text',
		default: { token: 'text-secondary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
