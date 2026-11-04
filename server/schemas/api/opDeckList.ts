import { z } from 'zod';
import { opCardNumberSchema } from './opCard';

/** A One Piece Card Game Deck List written by hand: paste text, `N[x] CARDNUMBER [name]` lines (ADR-0057), and the Leader picked. */
export const writeOpPlayerDeckListSchema = z.object({
	text: z.string().max(20_000),
	leaderNumber: opCardNumberSchema.nullable().optional(),
}).strict();

/** The card an Unresolved Deck Card is resolved to, picked from a bandai-keepr search. */
export const resolveOpUnresolvedDeckCardSchema = z.object({
	cardNumber: opCardNumberSchema,
}).strict();
