import type { ScreenModeConfigOf } from './contract';
import { z } from 'zod';
import { defineScreenModeConfigContract } from './contract';
import { editorField } from './fields';

/** The Card Spotlight Screen Mode's config contract: its shape, type, and defaults. */
export const cardModeConfigContract = defineScreenModeConfigContract({
	// Optional feature match binding (for decklist convenience, not required)
	featureMatchId: editorField(z.number().int().positive().nullable().optional(), {
		label: 'Feature Match Slot',
		card: 'source',
		reference: 'featureMatchSlot',
		placeholder: 'No match linked',
		description: 'Optionally link a Slot, whose Deck Lists then load on the card search page. Cards can be pushed to this Screen from the card search page either way.',
	}),
	/** The card's width in Event Canvas px; it replaced `scale` (ADR-0054). */
	cardWidth: editorField(z.number().int().min(120).max(1600).optional(), {
		label: 'Card width',
		card: 'content',
		group: 'card',
		description: 'In px.',
	}),
}, {
	featureMatchId: null,
	// The width the card fitted to a 1080-pixel-high Screen at the former scale of 1.
	cardWidth: 583,
}, {
	groups: {
		card: { title: 'Card', card: 'content' },
	},
});

export type CardModeConfig = ScreenModeConfigOf<typeof cardModeConfigContract>;
