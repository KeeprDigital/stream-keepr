import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** How the Talent Screen Mode looks: its Mode Tokens, by name within the mode. */
export const talentModeTokens = {
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
	'surface': {
		type: 'color',
		label: 'Talent card surface',
		default: { token: 'surface' },
	},
	'accent': {
		type: 'color',
		label: 'Accent bar and photo ring',
		default: { token: 'accent' },
	},
	'name-typography': {
		type: 'typography',
		label: 'Talent name type',
		default: { token: 'heading' },
	},
	'name-text': {
		type: 'color',
		label: 'Talent name text',
		default: { token: 'text-primary' },
	},
	'detail-typography': {
		type: 'typography',
		label: 'Role and Social Profile type',
		default: { token: 'body' },
	},
	'role-text': {
		type: 'color',
		label: 'Role text',
		default: { token: 'text-secondary' },
	},
	'profile-text': {
		type: 'color',
		label: 'Social Profile handle and icon',
		default: { token: 'text-primary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition>>;
