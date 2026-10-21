import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { defineScreenModeConfigContract } from './contract';

/** The Top Cut Screen Mode's config contract: its shape, type, and defaults. */
export const topCutModeConfigContract = defineScreenModeConfigContract({
	// Placeholder for top cut mode config
	bracketSize: z.number().int().positive().optional(),
}, {
	bracketSize: 8,
});

export type TopCutModeConfig = ScreenModeConfigOf<typeof topCutModeConfigContract>;
