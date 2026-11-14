import { z } from 'zod';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { PLAYER_SIDE_VALUES, SEAT_VALUES } from '~~/shared/types/enums';
import { MAX_SEAT_COMMANDERS } from '~~/shared/utils/commander';

/** A pasted Feature Match Deck List: `N[x] CARDNUMBER [name]` lines (ADR-0057). */
const deckListTextSchema = z.string().max(20_000);

export const featureMatchDeckListPreviewSchema = z.object({
	text: deckListTextSchema,
}).strict();

export const saveFeatureMatchDeckListSchema = z.object({
	side: z.enum(PLAYER_SIDE_VALUES),
	text: deckListTextSchema,
}).strict();

/**
 * A Commander Seat's pasted Deck List, any of Moxfield's four copies
 * (ADR-0087). The parser holds the limit on its bytes and lines, and names it.
 */
const commanderDeckListTextSchema = z.string().max(70_000);

export const commanderDeckListPreviewSchema = z.object({
	text: commanderDeckListTextSchema,
}).strict();

/** A save names the Commanders its operator confirmed: printings of the list, which the save checks. */
export const saveCommanderDeckListSchema = z.object({
	seat: z.enum(SEAT_VALUES),
	text: commanderDeckListTextSchema,
	commanders: z.array(z.uuid()).max(MAX_SEAT_COMMANDERS),
}).strict();

export const featureMatchDeckListParamsSchema = z.object({
	id: eventIdParamSchema,
	slotId: z.coerce.number().int().positive(),
	deckListId: z.coerce.number().int().positive(),
});
