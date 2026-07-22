import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { playerLists } from '~~/server/db/schema';

// ── Player List CRUD Schemas ──

export const createPlayerListSchema = createInsertSchema(playerLists)
	.omit({ id: true, eventId: true, createdAt: true, updatedAt: true })
	.extend({
		name: z.string().min(1).max(200),
	})
	.strict();

export const updatePlayerListSchema = createUpdateSchema(playerLists)
	.omit({ id: true, eventId: true, createdAt: true, updatedAt: true })
	.extend({
		name: z.string().min(1).max(200).optional(),
	})
	.strict();

// ── Member Management Schemas ──

const playerIdListSchema = z.array(z.number().int().positive())
	.min(1)
	.max(500)
	.refine(playerIds => new Set(playerIds).size === playerIds.length, {
		message: 'playerIds must not contain duplicates',
	});

export const addMembersSchema = z.object({
	playerIds: playerIdListSchema,
}).strict();

export const batchRemoveMembersSchema = z.object({
	playerIds: playerIdListSchema,
}).strict();

export const reorderMembersSchema = z.object({
	playerIds: playerIdListSchema,
}).strict();

// ── Route Params ──

export const playerListParamsSchema = z.object({
	id: z.coerce.number().int().positive(), // eventId
	listId: z.coerce.number().int().positive(),
});

export const playerListMemberParamsSchema = z.object({
	id: z.coerce.number().int().positive(), // eventId
	listId: z.coerce.number().int().positive(),
	playerId: z.coerce.number().int().positive(),
});

// ── Types ──

export type CreatePlayerListInput = z.infer<typeof createPlayerListSchema>;
export type UpdatePlayerListInput = z.infer<typeof updatePlayerListSchema>;
export type AddMembersInput = z.infer<typeof addMembersSchema>;
export type BatchRemoveMembersInput = z.infer<typeof batchRemoveMembersSchema>;
export type ReorderMembersInput = z.infer<typeof reorderMembersSchema>;
export type PlayerListParams = z.infer<typeof playerListParamsSchema>;
export type PlayerListMemberParams = z.infer<typeof playerListMemberParamsSchema>;
