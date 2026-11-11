import type { SupportedSocialNetwork } from '../socialProfiles';
import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { SUPPORTED_SOCIAL_NETWORK_KEYS, SUPPORTED_SOCIAL_NETWORKS } from '../socialProfiles';
import { TALENT_SCREEN_LAYOUT_VALUES, TALENT_SCREEN_SELECTION_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, headerConfigShape } from './subShapes';

/** The most Talents a lineup holds. */
export const TALENT_SCREEN_MAX_LINEUP = 8;

/** The title a shown header carries while its custom text is empty. */
export const TALENT_SCREEN_AUTO_HEADER_TEXT = 'On the Desk';

/**
 * The Talent Screen Mode's config contract (#782).
 *
 * `selection` chooses one Talent, `talentId`, or a lineup, `talentIds` in the
 * order shown. The choice not taken is kept, so switching back restores it. Each
 * is an Event Reference (ADR-0038), released when its Talent is deleted.
 *
 * `socialNetworks` is which Supported Social Networks show, always in the
 * catalog's order. With `rotateSocialProfiles` on, each Talent shows one of
 * its Social Profiles at a time, for `socialProfileDwellMs` each: a Social
 * Profile Rotation projected from server time, so every rendering agrees.
 *
 * Its header is off by default: a lower third has no title above it.
 */
export const talentModeConfigContract = defineScreenModeConfigContract({
	selection: editorField(z.enum(TALENT_SCREEN_SELECTION_VALUES), {
		label: 'Talent shown',
		card: 'source',
		description: 'One Talent at a time, or a lineup shown together.',
		options: { one: 'One Talent', lineup: 'A lineup' },
	}),
	talentId: editorField(z.number().int().positive().nullable(), {
		label: 'Talent',
		card: 'source',
		reference: 'talent',
		showWhen: ({ config }) => config.selection === 'one',
	}),
	talentIds: editorField(z.array(z.number().int().positive()).max(TALENT_SCREEN_MAX_LINEUP), {
		label: 'Lineup',
		card: 'source',
		reference: 'talentLineup',
		slot: 'talent-lineup',
		description: 'Shown in the order listed.',
		showWhen: ({ config }) => config.selection === 'lineup',
	}),
	layout: editorField(z.enum(TALENT_SCREEN_LAYOUT_VALUES), {
		label: 'Layout',
		card: 'content',
		group: 'layout',
		description: 'A bar across the bottom, or a panel filling the Screen.',
		options: { lowerThird: 'Lower third', fullPanel: 'Full panel' },
	}),
	showPhoto: editorField(z.boolean(), {
		label: 'Show photo',
		card: 'content',
		group: 'layout',
		description: 'Show each Talent\'s photo, or their initials without one.',
	}),
	showRole: editorField(z.boolean(), {
		label: 'Show role',
		card: 'content',
		group: 'layout',
		description: 'Show each Talent\'s role, such as Host, below their name.',
	}),
	socialNetworks: editorField(z.array(z.enum(SUPPORTED_SOCIAL_NETWORK_KEYS)).max(SUPPORTED_SOCIAL_NETWORK_KEYS.length), {
		label: 'Networks',
		card: 'content',
		group: 'social-profiles',
		description: 'The Social Profiles shown, in this order.',
		options: Object.fromEntries(SUPPORTED_SOCIAL_NETWORKS.map(network => [network.key, network.label])) as Record<SupportedSocialNetwork, string>,
	}),
	rotateSocialProfiles: editorField(z.boolean(), {
		label: 'Rotate Social Profiles',
		card: 'content',
		group: 'social-profiles',
		description: 'Show one Social Profile at a time, in turn, on every output alike.',
	}),
	socialProfileDwellMs: editorField(z.number().int().min(2000).max(60000), {
		label: 'Each profile shows for (seconds)',
		card: 'content',
		group: 'social-profiles',
		displayScale: 1000,
		showWhen: ({ config }) => config.rotateSocialProfiles === true,
	}),
	...headerConfigShape({
		shows: 'Show a title above the Talent.',
		auto: `Empty shows "${TALENT_SCREEN_AUTO_HEADER_TEXT}".`,
	}),
}, {
	selection: 'one',
	talentId: null,
	talentIds: [],
	layout: 'lowerThird',
	showPhoto: true,
	showRole: true,
	socialNetworks: [...SUPPORTED_SOCIAL_NETWORK_KEYS],
	rotateSocialProfiles: false,
	socialProfileDwellMs: 8000,
	...DEFAULT_HEADER_CONFIG,
	showHeader: false,
}, {
	groups: {
		'layout': { title: 'Layout', card: 'content' },
		'social-profiles': { title: 'Social Profiles', card: 'content' },
	},
});

export type TalentModeConfig = ScreenModeConfigOf<typeof talentModeConfigContract>;

/** The Talents a Talent Screen shows, in order: its one Talent, or its lineup. */
export function talentScreenTalentIds(config: Pick<TalentModeConfig, 'selection' | 'talentId' | 'talentIds'>): number[] {
	if (config.selection === 'lineup') {
		return [
			...new Set(config.talentIds),
		];
	}
	return config.talentId == null
		? []
		: [config.talentId];
}

/**
 * The Talents whose photos a Talent Screen shows: its Talents while it shows
 * photos, else none. Its Screen Output resolves exactly these photos (ADR-0070).
 */
export function talentScreenPhotoTalentIds(config: Pick<TalentModeConfig, 'selection' | 'talentId' | 'talentIds' | 'showPhoto'>): number[] {
	return config.showPhoto
		? talentScreenTalentIds(config)
		: [];
}
