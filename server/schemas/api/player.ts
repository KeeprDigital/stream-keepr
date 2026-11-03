import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { players } from '~~/server/db/schema';
import { OP_CARD_COLORS } from '~~/shared/types/card/op';
import { isOpCardImageUrl } from '~~/shared/utils/card/op';
import { storedOpLeader } from '~~/shared/utils/gameData';
import { opCardNumberSchema } from './opCard';

// Game-specific player data (discriminated union)
const mtgGameDataSchema = z.object({
	type: z.literal('mtg'),
	deckName: z.string().max(200).nullable().optional(),
	deckColors: z.string().max(50).nullable().optional(),
}).strict();

/** A Leader's inline snapshot. Its image goes on air, so it must be a bandai-keepr Printing image. */
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
	// A Slot side's Deck List reference; the setup write checks it names one of the Slot's.
	featureMatchDeckList: z.object({
		id: z.number().int().positive(),
		mainboardCount: z.number().int().nonnegative(),
	}).strict().nullable().optional(),
}).strict();

export const playerGameDataSchema = z.discriminatedUnion('type', [mtgGameDataSchema, opGameDataSchema]);

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
		// String length limits
		name: z.string().min(1).max(200),
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
		name: z.string().min(1).max(200).optional(),
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
	id: z.coerce.number().int().positive(),
	playerId: z.coerce.number().int().positive(),
});

// QUERY
export const playerQuerySchema = z.object({
	listId: z.coerce.number().int().positive().optional(),
}).optional();

/* TYPES */
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;
