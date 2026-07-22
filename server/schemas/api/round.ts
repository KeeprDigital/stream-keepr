import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { rounds } from '~~/server/db/schema';
import { ROUND_CONTROL_MODE_VALUES } from '~~/shared/types/enums';

const roundControlModeSchema = z.enum(ROUND_CONTROL_MODE_VALUES);

// CREATE
export const createRoundSchema = createInsertSchema(rounds)
	.omit({
		id: true,
		eventId: true,
		externalId: true,
		externalSource: true,
		lastSyncedAt: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		phaseId: z.number().int().positive(),
		name: z.string().min(1).max(200),
		roundNumber: z.number().int().positive(),
		controlMode: roundControlModeSchema.optional(),
	})
	.strict();

// UPDATE
export const updateRoundSchema = createUpdateSchema(rounds)
	.omit({
		id: true,
		eventId: true,
		externalId: true,
		externalSource: true,
		lastSyncedAt: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		phaseId: z.number().int().positive().optional(),
		name: z.string().min(1).max(200).optional(),
		roundNumber: z.number().int().positive().optional(),
		controlMode: roundControlModeSchema.optional(),
	})
	.strict();

// ROUTE PARAMS
export const roundParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	roundId: z.coerce.number().int().positive(),
});

/* TYPES */
export type CreateRoundInput = z.infer<typeof createRoundSchema>;
export type UpdateRoundInput = z.infer<typeof updateRoundSchema>;
export type RoundParams = z.infer<typeof roundParamsSchema>;
