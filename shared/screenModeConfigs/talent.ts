import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { SUPPORTED_SOCIAL_NETWORK_KEYS } from '../socialProfiles';
import { TALENT_SCREEN_LAYOUT_VALUES, TALENT_SCREEN_SELECTION_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';
import { DEFAULT_HEADER_CONFIG, headerConfigShape } from './subShapes';

/** The most Talents a lineup holds. */
export const TALENT_SCREEN_MAX_LINEUP = 8;

/**
 * The Talent Screen Mode's config contract (#782).
 *
 * `selection` chooses one Talent, `talentId`, or a lineup, `talentIds` in the
 * order shown. The choice not taken is kept, so switching back restores it. Each
 * is an Event Reference (ADR-0038), released when its Talent is deleted.
 *
 * `socialNetworks` is which Supported Social Networks show, always in the
 * catalogue's order. With `rotateSocialProfiles` on, each Talent shows one of
 * its Social Profiles at a time, for `socialProfileDwellMs` each: a Social
 * Profile Rotation projected from server time, so every rendering agrees.
 *
 * Its header is off by default: a lower third has no title above it.
 */
export const talentModeConfigContract = defineScreenModeConfigContract({
	selection: editorField(z.enum(TALENT_SCREEN_SELECTION_VALUES), { label: 'Show' }),
	talentId: z.number().int().positive().nullable(),
	talentIds: z.array(z.number().int().positive()).max(TALENT_SCREEN_MAX_LINEUP),
	layout: editorField(z.enum(TALENT_SCREEN_LAYOUT_VALUES), { label: 'Layout' }),
	showPhoto: editorField(z.boolean(), { label: 'Show photo' }),
	showRole: editorField(z.boolean(), { label: 'Show role' }),
	socialNetworks: z.array(z.enum(SUPPORTED_SOCIAL_NETWORK_KEYS)).max(SUPPORTED_SOCIAL_NETWORK_KEYS.length),
	rotateSocialProfiles: editorField(z.boolean(), { label: 'Rotate Social Profiles' }),
	socialProfileDwellMs: editorField(z.number().int().min(2000).max(60000), { label: 'Each profile shows for (seconds)', displayScale: 1000 }),
	...headerConfigShape,
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
});

export type TalentModeConfig = ScreenModeConfigOf<typeof talentModeConfigContract>;

/** The Talents a Talent Screen shows, in order: its one Talent, or its lineup. */
export function talentScreenTalentIds(config: Pick<TalentModeConfig, 'selection' | 'talentId' | 'talentIds'>): number[] {
	if (config.selection === 'lineup')
		return [...new Set(config.talentIds)];
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
