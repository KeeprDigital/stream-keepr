import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { CARD_ANIMATION_SPEED_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';

/** The Card Screen Mode's config contract: its shape, type, and defaults. */
export const cardModeConfigContract = defineScreenModeConfigContract({
	// Animation
	animationEnabled: editorField(z.boolean().optional(), { label: 'Enable Animation' }),
	animationSpeed: editorField(z.enum(CARD_ANIMATION_SPEED_VALUES).optional(), { label: 'Animation Speed' }),

	// Optional feature match binding (for decklist convenience, not required)
	featureMatchId: z.number().int().positive().nullable().optional(),
}, {
	featureMatchId: null,
	animationEnabled: true,
	animationSpeed: 'normal',
}, {
	// The card's size is its `card-width` Mode Token (#824).
	formerFields: ['scale'],
});

export type CardModeConfig = ScreenModeConfigOf<typeof cardModeConfigContract>;

/** What a rendered Card reads: its animation, without the mode's binding. */
export type CardDisplayConfig = Omit<CardModeConfig, 'featureMatchId'>;
