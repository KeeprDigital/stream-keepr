import { z } from 'zod';

const featureMatchNoteSchema = z
	.string()
	.max(5000)
	.transform(note => note.trim() || null)
	.nullable();

export const createFeatureMatchAssignmentSchema = z.object({
	roundId: z.number().int().positive(),
	slotId: z.number().int().positive(),
	matchId: z.number().int().positive(),
	note: featureMatchNoteSchema.optional(),
	confirmedNoteDiscards: z.array(z.object({
		assignmentId: z.number().int().positive(),
		updatedAt: z.coerce.date(),
	}).strict()).optional(),
}).strict();

export const updateFeatureMatchAssignmentSchema = z.object({
	note: featureMatchNoteSchema.optional(),
}).strict();
