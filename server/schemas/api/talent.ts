import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { eventTalents } from '~~/server/db/schema';

// CREATE
export const createTalentSchema = createInsertSchema(eventTalents)
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		eventId: true,
	})
	.extend({
		name: z.string().min(1).max(200),
	})
	.strict();

// UPDATE
export const updateTalentSchema = createUpdateSchema(eventTalents)
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		eventId: true,
	})
	.extend({
		name: z.string().min(1).max(200).optional(),
	})
	.strict();

// ROUTE PARAMS
export const talentParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	talentId: z.coerce.number().int().positive(),
});

/* TYPES */
export type CreateTalentInput = z.infer<typeof createTalentSchema>;
export type UpdateTalentInput = z.infer<typeof updateTalentSchema>;
export type TalentParams = z.infer<typeof talentParamsSchema>;
