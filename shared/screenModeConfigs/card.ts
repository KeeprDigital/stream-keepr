import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { CARD_ANIMATION_SPEED_VALUES } from '../types/enums';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';

/** The Card Screen Mode's config contract: its shape, type, and defaults. */
export const cardModeConfigContract = defineScreenModeConfigContract({
	// Card sizing: a multiplier. The editor's 0.5–2 is the product range (#498);
	// a value stored under the former 0.1–5 reads clamped into it.
	scale: editorField(z.number().min(0.5).max(2).optional(), { label: 'Card Scale', step: 0.1 }),

	// Animation
	animationEnabled: editorField(z.boolean().optional(), { label: 'Enable Animation' }),
	animationSpeed: editorField(z.enum(CARD_ANIMATION_SPEED_VALUES).optional(), { label: 'Animation Speed' }),

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
