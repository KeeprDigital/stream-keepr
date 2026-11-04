import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { rounds } from '~~/server/db/schema';
import { ROUND_CONTROL_MODE_VALUES } from '~~/shared/types/enums';
import { ROUND_DURATION_MINUTES_MAX, ROUND_DURATION_MINUTES_MIN } from '~~/shared/utils/roundClock';

const roundControlModeSchema = z.enum(ROUND_CONTROL_MODE_VALUES);

/** A Round's start, sent as an ISO instant and stored as one; `null` clears it (ADR-0066). */
const roundStartedAtSchema = z.iso.datetime({ offset: true }).transform(value => new Date(value)).nullable();

/** A Round's duration in whole minutes; `null` clears it (ADR-0066). */
const roundDurationMinutesSchema = z.number().int().min(ROUND_DURATION_MINUTES_MIN).max(ROUND_DURATION_MINUTES_MAX).nullable();

// CREATE
export const createRoundSchema = createInsertSchema(rounds)
	.omit({
		id: true,
		eventId: true,
		externalId: true,
		externalSource: true,
		lastSyncedAt: true,
		// A new Round starts untimed; its timing is an edit (ADR-0066).
		startedAt: true,
		durationMinutes: true,
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
		startedAt: roundStartedAtSchema.optional(),
		durationMinutes: roundDurationMinutesSchema.optional(),
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
