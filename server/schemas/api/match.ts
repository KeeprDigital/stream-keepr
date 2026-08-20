import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { matches } from '~~/server/db/schema';
import { playerGameDataSchema } from './player';

// Embedded player data for match slots (same shape as feature match player data)
const matchPlayerDataSchema = z.object({
	name: z.string().min(1).max(200),
	pronouns: z.string().max(50).nullable().optional(),
	wins: z.number().int().nonnegative().nullable().optional(),
	losses: z.number().int().nonnegative().nullable().optional(),
	draws: z.number().int().nonnegative().nullable().optional(),
	position: z.number().int().positive().nullable().optional(),
	points: z.number().int().nonnegative().nullable().optional(),
	deckId: z.number().int().positive().nullable().optional(),
	archetypeId: z.number().int().positive().nullable().optional(),
	deckList: z.string().max(100000).nullable().optional(),
	lgs: z.string().max(200).nullable().optional(),
	gameData: playerGameDataSchema.nullable().optional(),
}).strict();

// CREATE
export const createMatchSchema = createInsertSchema(matches)
	.omit({
		id: true,
		eventId: true,
		externalId: true,
		externalSource: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		roundId: z.number().int().positive(),
		tableNumber: z.number().int().positive().nullable().optional(),
		player1Id: z.number().int().positive().nullable().optional(),
		player2Id: z.number().int().positive().nullable().optional(),
		player1Data: matchPlayerDataSchema.nullable().optional(),
		player2Data: matchPlayerDataSchema.nullable().optional(),
		hasResult: z.boolean().optional(),
		player1GameWins: z.number().int().nonnegative().nullable().optional(),
		player2GameWins: z.number().int().nonnegative().nullable().optional(),
		gameDraws: z.number().int().nonnegative().nullable().optional(),
		isBye: z.boolean().optional(),
		resultString: z.string().max(500).nullable().optional(),
	})
	.strict();

// UPDATE
export const updateMatchSchema = createUpdateSchema(matches)
	.omit({
		id: true,
		eventId: true,
		externalId: true,
		externalSource: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		roundId: z.number().int().positive().optional(),
		tableNumber: z.number().int().positive().nullable().optional(),
		player1Id: z.number().int().positive().nullable().optional(),
		player2Id: z.number().int().positive().nullable().optional(),
		player1Data: matchPlayerDataSchema.nullable().optional(),
		player2Data: matchPlayerDataSchema.nullable().optional(),
		hasResult: z.boolean().optional(),
		player1GameWins: z.number().int().nonnegative().nullable().optional(),
		player2GameWins: z.number().int().nonnegative().nullable().optional(),
		gameDraws: z.number().int().nonnegative().nullable().optional(),
		isBye: z.boolean().optional(),
		resultString: z.string().max(500).nullable().optional(),
	})
	.strict();

// ROUTE PARAMS
export const matchParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	matchId: z.coerce.number().int().positive(),
});

// QUERY (for filtering by roundId)
export const matchQuerySchema = z.object({
	roundId: z.coerce.number().int().positive().optional(),
});

// PROMOTE (for promotion endpoint)
export const promoteMatchSchema = z.object({
	matchId: z.number().int().positive(),
	confirmedNoteDiscards: z.array(z.object({
		assignmentId: z.number().int().positive(),
		updatedAt: z.coerce.date(),
	}).strict()).optional(),
}).strict();

/* TYPES */
export type CreateMatchInput = z.infer<typeof createMatchSchema>;
export type UpdateMatchInput = z.infer<typeof updateMatchSchema>;
export type MatchParams = z.infer<typeof matchParamsSchema>;
export type MatchQuery = z.infer<typeof matchQuerySchema>;
export type PromoteMatchInput = z.infer<typeof promoteMatchSchema>;
