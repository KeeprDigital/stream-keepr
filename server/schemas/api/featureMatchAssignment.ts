import { z } from 'zod';

export const createFeatureMatchAssignmentSchema = z.object({
	roundId: z.number().int().positive(),
	slotId: z.number().int().positive(),
	matchId: z.number().int().positive(),
	note: z.string().max(5000).nullable().optional(),
}).strict();

export const updateFeatureMatchAssignmentSchema = z.object({
	matchId: z.number().int().positive().optional(),
	note: z.string().max(5000).nullable().optional(),
}).strict();
