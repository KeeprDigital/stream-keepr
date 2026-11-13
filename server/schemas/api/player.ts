import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { players } from '~~/server/db/schema';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { OP_CARD_COLORS } from '~~/shared/types/card/op';
import { isOpCardImageUrl } from '~~/shared/utils/card/op';
import { MAX_SEAT_COMMANDERS } from '~~/shared/utils/commander';
import { storedOpLeader } from '~~/shared/utils/gameData';
import { opCardNumberSchema } from './opCard';

// Game-specific player data (discriminated union)
const mtgGameDataSchema = z.object({
	type: z.literal('mtg'),
	deckName: z.string().max(200).nullable().optional(),
	deckColors: z.string().max(50).nullable().optional(),
}).strict();

/**
 * A picked Leader as a save sends it. The server keeps only its number, a card
 * catalogue reference (ADR-0074); its image must be a bandai-keepr Printing image.
 */
const opLeaderSchema = z.object({
	number: opCardNumberSchema,
	name: z.string().trim().min(1).max(200),
	colors: z.array(z.enum(OP_CARD_COLORS)).max(OP_CARD_COLORS.length),
	imageUrl: z.url().max(500).refine(isOpCardImageUrl, { message: 'Not a One Piece card image' }),
}).strict();

const opGameDataSchema = z.object({
	type: z.literal('op'),
	// Free text typed before the Leader picker names no card, so it is read as none.
	leader: z.preprocess(
		value => value === undefined
			? undefined
			: storedOpLeader(value),
		opLeaderSchema.nullable().optional(),
	),
}).strict();

export const playerGameDataSchema = z.discriminatedUnion('type', [mtgGameDataSchema, opGameDataSchema]);

/**
 * A picked Commander as a save sends it: one printing of a Magic: The Gathering
 * card, by its Scryfall id (ADR-0086). Nothing checks that the card may be one.
 */
const commanderSchema = z.object({
	scryfallId: z.uuid(),
	name: z.string().trim().min(1).max(200),
	colorIdentity: z.string().regex(/^[WUBRG]*$/).refine(letters => new Set(letters).size === letters.length, {
		message: 'A colour identity names each colour at most once',
	}),
	setCode: z.string().trim().min(1).max(10),
	collectorNumber: z.string().trim().min(1).max(20),
}).strict();

/**
 * A Slot side's game data, as a setup save writes it: a One Piece side may also
 * reference its Feature Match Deck List, which the setup write checks names one
 * of the Slot's (ADR-0057). Nothing else may write a reference. A linked side's
 * Player Deck List reference, which its form holds, is the server's to write
 * (ADR-0074), so it is dropped.
 */
export const slotSideGameDataSchema = z.discriminatedUnion('type', [
	// Only a Commander Event's Seat holds Commanders, which the setup write checks (ADR-0086).
	mtgGameDataSchema.extend({
		commanders: z.array(commanderSchema).max(MAX_SEAT_COMMANDERS).nullable().optional(),
	}).strict(),
	opGameDataSchema.extend({
		featureMatchDeckList: z.object({
			id: z.number().int().positive(),
			mainboardCount: z.number().int().nonnegative(),
		}).strict().nullable().optional(),
		deckList: z.unknown().optional(),
	}).strict().transform(({ deckList: _deckList, ...gameData }) => gameData),
]);

// CREATE
export const createPlayerSchema = createInsertSchema(players)
	.omit({
		id: true,
		eventId: true,
		// Manually created players never carry Melee identity — the server
		// always stores them with no external provenance. Accepting these
		// would let a client inject a row into Melee's identity namespace
		// (unique on eventId+externalId+externalSource) for a later sync to
		// adopt or collide with.
		externalId: true,
		externalSource: true,
		externalStatus: true,
		isActive: true,
		lastSeenAt: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		// String length limits. A blank name is the Player write's to refuse:
		// only a One Piece Card Game Player with a Nickname may have one (ADR-0074).
		name: z.string().trim().max(200),
		nickname: z.string().max(100).nullable().optional(),
		pronouns: z.string().max(50).nullable().optional(),
		lgs: z.string().max(200).nullable().optional(),
		// Numeric bounds
		wins: z.number().int().nonnegative().nullable().optional(),
		losses: z.number().int().nonnegative().nullable().optional(),
		draws: z.number().int().nonnegative().nullable().optional(),
		position: z.number().int().positive().nullable().optional(),
		points: z.number().int().nonnegative().nullable().optional(),
		archetypeId: z.number().int().positive().nullable().optional(),
		// JSON structural validation
		gameData: playerGameDataSchema.nullable().optional(),
	})
	.strict();

// UPDATE
export const updatePlayerSchema = createUpdateSchema(players)
	.omit({
		id: true,
		eventId: true,
		// Same rule as create — manual updates never carry Melee identity.
		// The server always resolves provenance itself (see createPlayerSchema).
		externalId: true,
		externalSource: true,
		externalStatus: true,
		isActive: true,
		lastSeenAt: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		// String length limits (all optional for partial updates)
		name: z.string().trim().max(200).optional(),
		nickname: z.string().max(100).nullable().optional(),
		pronouns: z.string().max(50).nullable().optional(),
		lgs: z.string().max(200).nullable().optional(),
		// Numeric bounds (all optional for partial updates)
		wins: z.number().int().nonnegative().nullable().optional(),
		losses: z.number().int().nonnegative().nullable().optional(),
		draws: z.number().int().nonnegative().nullable().optional(),
		position: z.number().int().positive().nullable().optional(),
		points: z.number().int().nonnegative().nullable().optional(),
		archetypeId: z.number().int().positive().nullable().optional(),
		// JSON structural validation (all optional for partial updates)
		gameData: playerGameDataSchema.nullable().optional(),
	})
	.strict();

// ROUTE PARAMS
export const playerParamsSchema = z.object({
	id: eventIdParamSchema,
	playerId: z.coerce.number().int().positive(),
});

// QUERY
export const playerQuerySchema = z.object({
	listId: z.coerce.number().int().positive().optional(),
}).optional();

/* TYPES */
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
