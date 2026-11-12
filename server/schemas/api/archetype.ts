import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { archetypes } from '~~/server/db/schema';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';
import { METAGAME_CHART_SERIES_COUNT } from '~~/shared/utils/metagameChart';

/** A Pinned Chart Series: one of the Theme's chart series, or null for none. Set by editing an Archetype. */
const chartSeriesSchema = z.number().int().min(1).max(METAGAME_CHART_SERIES_COUNT).nullable().optional();

// ── Archetype CRUD Schemas ──

export const createArchetypeSchema = createInsertSchema(archetypes)
	.omit({
		id: true,
		eventId: true,
		chartSeries: true,
		leaderCardNumber: true,
		customised: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		name: z.string().trim().min(1).max(200),
		colors: z.string().max(50).nullable().optional(),
	})
	.strict();

export const updateArchetypeSchema = createUpdateSchema(archetypes)
	.omit({
		id: true,
		eventId: true,
		leaderCardNumber: true,
		customised: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		name: z.string().trim().min(1).max(200).optional(),
		colors: z.string().max(50).nullable().optional(),
		chartSeries: chartSeriesSchema,
	})
	.strict();

// ── Key Cards ──

export const setArchetypeKeyCardsSchema = z.object({
	/** Ordered list of card IDs to set as key cards (max 5). Empty array clears all. */
	cardIds: z.array(z.number().int().positive()).max(5).optional(),
	/** Alternative: card names to look up and set as key cards (max 5). */
	cardNames: z.array(z.string().trim().min(1)).max(5).optional(),
}).strict().refine(
	data => data.cardIds !== undefined || data.cardNames !== undefined,
	{ message: 'Either cardIds or cardNames must be provided' },
).refine(
	data => !(data.cardIds !== undefined && data.cardNames !== undefined),
	{ message: 'Provide either cardIds or cardNames, not both' },
);

// ── Merge ──

/** The Archetype the one in the path is merged into. */
export const mergeArchetypeSchema = z.object({
	intoArchetypeId: z.number().int().positive(),
}).strict();

// ── Route Params ──

export const archetypeParamsSchema = z.object({
	id: eventIdParamSchema, // eventId
	archetypeId: z.coerce.number().int().positive(),
});

// ── Types ──

export type CreateArchetypeInput = z.infer<typeof createArchetypeSchema>;
export type UpdateArchetypeInput = z.infer<typeof updateArchetypeSchema>;
export type ArchetypeParams = z.infer<typeof archetypeParamsSchema>;
export type SetArchetypeKeyCardsInput = z.infer<typeof setArchetypeKeyCardsSchema>;
