import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { CARD_ANIMATION_SPEED_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';

/** The Card Screen Mode's config contract: its shape, type, and defaults. */
export const cardModeConfigContract = defineScreenModeConfigContract({
	// Card sizing: a multiplier
	scale: z.number().min(0.1).max(5).optional(),

	// Animation
	animationEnabled: z.boolean().optional(),
	animationSpeed: z.enum(CARD_ANIMATION_SPEED_VALUES).optional(),

	// Optional feature match binding (for decklist convenience, not required)
	featureMatchId: z.number().int().positive().nullable().optional(),
}, {
	featureMatchId: null,
	scale: 1,
	animationEnabled: true,
	animationSpeed: 'normal',
});

export type CardModeConfig = ScreenModeConfigOf<typeof cardModeConfigContract>;

/** What a rendered Card reads: its sizing and animation, without the mode's binding. */
export type CardDisplayConfig = Omit<CardModeConfig, 'featureMatchId'>;
