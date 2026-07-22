import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { events } from '~~/server/db/schema';
import { FEATURE_MATCH_ORIENTATION_VALUES, GAME_VALUES } from '~~/shared/types/enums';

// Shared field constraints applied to both create and update schemas.
// Centralised here so bounds stay in sync between the two schemas.
const eventFieldConstraints = {
	name: z.string().min(1).max(200),
	description: z.string().max(5000).nullable().optional(),
	holdingText: z.string().max(1000).nullable().optional(),
	featureMatchDefaultExtraTurnsLabel: z.string().min(1).max(100).optional(),
	cardTimeout: z.number().int().nonnegative().max(300).optional(),
	numFeatureMatches: z.number().int().min(1).max(50).optional(),
	featureMatchDefaultBestOf: z.number().int().min(1).max(9).optional(),
	featureMatchDefaultStartingLife: z.number().int().nonnegative().max(99999).optional(),
	featureMatchDefaultClockDuration: z.number().int().nonnegative().max(999).optional(),
	featureMatchDefaultExtraTurns: z.number().int().nonnegative().max(20).optional(),
};

const SERVER_MANAGED_OMIT = {
	id: true,
	createdAt: true,
	updatedAt: true,
	meleeEnabled: true,
	meleeEventId: true,
	meleeClientId: true,
	meleeClientSecret: true,
	initialSetupCompletedAt: true,
	lastEventSyncedAt: true,
	lastPlayersSyncedAt: true,
	lastDecklistsSyncedAt: true,
	lastSyncError: true,
	meleeSyncLeaseToken: true,
	meleeSyncLeaseCommand: true,
	meleeSyncLeaseExpiresAt: true,
} as const;

// CREATE
export const createEventSchema = createInsertSchema(events)
	.omit({
		...SERVER_MANAGED_OMIT,
		// An Event has no Event Talent rows at creation time. Accepting these
		// foreign keys would allow a caller to attach another Event's Talent.
		commentator1TalentId: true,
		commentator2TalentId: true,
	})
	.extend({
		...eventFieldConstraints,
		game: z.enum(GAME_VALUES),
		featureMatchOrientation: z.enum(FEATURE_MATCH_ORIENTATION_VALUES).optional(),
	})
	.strict();

// UPDATE — all fields optional for partial updates
export const updateEventSchema = createUpdateSchema(events)
	.omit({
		...SERVER_MANAGED_OMIT,
		// Changing games in place would reinterpret Players, Decks and active
		// Feature Match Sessions under a different ruleset. Create a new Event
		// for an explicit conversion instead.
		game: true,
	})
	.extend({
		...eventFieldConstraints,
		name: eventFieldConstraints.name.optional(),
	})
	.strict();

// MELEE CONFIG

/** Full internal schema — all 4 fields required. Used for DB writes. */
export const meleeConfigSchema = z.object({
	meleeEnabled: z.boolean(),
	meleeEventId: z.string().max(100).nullable(),
	meleeClientId: z.string().max(200).nullable(),
	meleeClientSecret: z.string().max(500).nullable(),
});

/**
 * PUT /melee-config request body.
 * `meleeClientSecret` is optional — if omitted the existing secret is preserved.
 */
export const meleeConfigUpdateSchema = meleeConfigSchema.extend({
	meleeClientSecret: z.string().max(500).nullable().optional(),
});

// ROUTE PARAMS
export const eventParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
});

/* TYPES */
export type CreateEventInput = z.infer<typeof createEventSchema>;
export type UpdateEventInput = z.infer<typeof updateEventSchema>;
export type MeleeConfigInput = z.infer<typeof meleeConfigUpdateSchema>;
