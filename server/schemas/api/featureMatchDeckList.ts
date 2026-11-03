import { z } from 'zod';
import { PLAYER_SIDE_VALUES } from '~~/shared/types/enums';

/** A pasted Feature Match Deck List: `N[x] CARDNUMBER [name]` lines (ADR-0057). */
const deckListTextSchema = z.string().max(20_000);

export const featureMatchDeckListPreviewSchema = z.object({
	text: deckListTextSchema,
}).strict();

export const saveFeatureMatchDeckListSchema = z.object({
	side: z.enum(PLAYER_SIDE_VALUES),
	text: deckListTextSchema,
}).strict();

export const featureMatchDeckListParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	slotId: z.coerce.number().int().positive(),
	deckListId: z.coerce.number().int().positive(),
});
