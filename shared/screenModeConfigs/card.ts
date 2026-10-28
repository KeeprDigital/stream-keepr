import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';

/** The Card Screen Mode's config contract: its shape, type, and defaults. */
export const cardModeConfigContract = defineScreenModeConfigContract({
	// Optional feature match binding (for decklist convenience, not required)
	featureMatchId: z.number().int().positive().nullable().optional(),
	/** The card's width in Event Canvas px; it replaced `scale` (ADR-0053). */
	cardWidth: editorField(z.number().int().min(120).max(1600).optional(), { label: 'Card Width' }),
}, {
	featureMatchId: null,
	// The width the card fitted to a 1080-pixel-high Screen at the former scale of 1.
	cardWidth: 583,
}, {
	// The card's motion is its `motion` Mode Token (#824, #844).
	formerFields: ['scale', 'animationEnabled', 'animationSpeed'],
});

export type CardModeConfig = ScreenModeConfigOf<typeof cardModeConfigContract>;
