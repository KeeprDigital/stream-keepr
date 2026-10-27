import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { defineScreenModeConfigContract } from './contract';

/** The Card Screen Mode's config contract: its shape, type, and defaults. */
export const cardModeConfigContract = defineScreenModeConfigContract({
	// Optional feature match binding (for decklist convenience, not required)
	featureMatchId: z.number().int().positive().nullable().optional(),
}, {
	featureMatchId: null,
}, {
	// The card's size and motion are its `card-width` and `motion` Mode Tokens (#824, #844).
	formerFields: ['scale', 'animationEnabled', 'animationSpeed'],
});

export type CardModeConfig = ScreenModeConfigOf<typeof cardModeConfigContract>;
