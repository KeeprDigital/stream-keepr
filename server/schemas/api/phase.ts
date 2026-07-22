import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { phases } from '~~/server/db/schema';

// CREATE
export const createPhaseSchema = createInsertSchema(phases)
	.omit({
		id: true,
		eventId: true,
		externalId: true,
		externalSource: true,
		formatExternalId: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		name: z.string().min(1).max(200),
		sortOrder: z.number().int().nonnegative().optional(),
	})
	.strict();

// UPDATE
export const updatePhaseSchema = createUpdateSchema(phases)
	.omit({
		id: true,
		eventId: true,
		externalId: true,
		externalSource: true,
		formatExternalId: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		name: z.string().min(1).max(200).optional(),
		sortOrder: z.number().int().nonnegative().optional(),
	})
	.strict();

// ROUTE PARAMS
export const phaseParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	phaseId: z.coerce.number().int().positive(),
});

/* TYPES */
export type CreatePhaseInput = z.infer<typeof createPhaseSchema>;
export type UpdatePhaseInput = z.infer<typeof updatePhaseSchema>;
export type PhaseParams = z.infer<typeof phaseParamsSchema>;
