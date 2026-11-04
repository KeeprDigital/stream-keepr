import type { DeclaredModeTokenDefinition } from '../modules/theme/vocabulary';

/** The Talent settings groups its Mode Tokens may name (ADR-0071). */
export type TalentSettingsGroup = 'header' | 'layout' | 'social-profiles';

/** How the Talent Screen Mode looks: its Mode Tokens, by name within the mode. */
export const talentModeTokens = {
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
	'surface': {
		type: 'color',
		label: 'Talent card surface',
		settingsGroup: 'layout',
		default: { token: 'surface' },
	},
	'accent': {
		type: 'color',
		label: 'Accent bar and photo ring',
		settingsGroup: 'layout',
		default: { token: 'accent' },
	},
	'name-typography': {
		type: 'typography',
		label: 'Talent name type',
		settingsGroup: 'layout',
		default: { token: 'heading' },
	},
	'name-text': {
		type: 'color',
		label: 'Talent name text',
		settingsGroup: 'layout',
		default: { token: 'text-primary' },
	},
	'detail-typography': {
		type: 'typography',
		label: 'Role and Social Profile type',
		settingsGroup: 'layout',
		default: { token: 'body' },
	},
	'role-text': {
		type: 'color',
		label: 'Role text',
		settingsGroup: 'layout',
		default: { token: 'text-secondary' },
	},
	'profile-text': {
		type: 'color',
		label: 'Social Profile handle and icon',
		settingsGroup: 'social-profiles',
		default: { token: 'text-primary' },
	},
} as const satisfies Readonly<Record<string, DeclaredModeTokenDefinition<TalentSettingsGroup>>>;
