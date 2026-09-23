import { z } from 'zod';
import {
	BOARD_SELECTION_VALUES,
	METAGAME_CARD_SORT_BY_VALUES,
	METAGAME_CONVERSION_METRIC_VALUES,
	METAGAME_SCOPE_VALUES,
	METAGAME_SORT_BY_VALUES,
} from '~~/shared/types/enums';
import { CARD_TYPE_BUCKET_ORDER } from '~~/shared/utils/metagame';

// ─── Shared query param schemas ─────────────────────────────────

export const metagameScopeSchema = z.enum(METAGAME_SCOPE_VALUES).default('all');
const metagameCardSortBySchema = z.enum(METAGAME_CARD_SORT_BY_VALUES);
const metagameSortBySchema = z.enum(METAGAME_SORT_BY_VALUES);

export const metagameQuerySchema = z.object({
	scope: metagameScopeSchema,
	topN: z.coerce.number().int().min(1).max(500).optional(),
	minPoints: z.coerce.number().int().min(0).max(999).optional(),
	playerListId: z.coerce.number().int().positive().optional(),
}).refine(
	data => data.scope !== 'topN' || data.topN != null,
	{ message: 'topN is required when scope is topN', path: ['topN'] },
).refine(
	data => data.scope !== 'minPoints' || data.minPoints != null,
	{ message: 'minPoints is required when scope is minPoints', path: ['minPoints'] },
).refine(
	data => data.scope !== 'playerList' || data.playerListId != null,
	{ message: 'playerListId is required when scope is playerList', path: ['playerListId'] },
);

export const boardSelectionSchema = z.enum(BOARD_SELECTION_VALUES).default('full');

export const metagameCardTableQuerySchema = metagameQuerySchema.and(z.object({
	board: boardSelectionSchema,
}));

const cardTypeBucketSchema = z.enum(CARD_TYPE_BUCKET_ORDER);

/**
 * Comma-separated card-type buckets to drop from the breakdown, applied
 * server-side BEFORE `limit` so a filtered top-N still returns N rows.
 */
export const metagameExcludeTypesSchema = z.string()
	.trim()
	.min(1)
	.transform(value => value.split(','))
	.pipe(z.array(cardTypeBucketSchema).min(1).max(CARD_TYPE_BUCKET_ORDER.length));

export const metagameCardsQuerySchema = metagameCardTableQuerySchema.and(z.object({
	sortBy: metagameCardSortBySchema.default('inclusionRate'),
	limit: z.coerce.number().int().min(1).max(500).default(50),
	/** Optional filter by archetype id */
	archetypeId: z.coerce.number().int().positive().optional(),
	/** Legacy Screen config filter by archetype name */
	archetype: z.string().trim().min(1).max(200).optional(),
	excludeTypes: metagameExcludeTypesSchema.optional(),
}));

/**
 * Optional conversion target: how far a player must have made it — a Top N
 * placement or a minimum match-point total — to count as converted. Both
 * params travel together; when absent, conversion rates come back null.
 */
export const metagameConversionQuerySchema = z.object({
	conversionMetric: z.enum(METAGAME_CONVERSION_METRIC_VALUES).optional(),
	conversionThreshold: z.coerce.number().int().min(0).max(999).optional(),
}).refine(
	data => (data.conversionMetric == null) === (data.conversionThreshold == null),
	{ message: 'conversionMetric and conversionThreshold must be provided together', path: ['conversionThreshold'] },
);

export const metagameArchetypesQuerySchema = metagameQuerySchema.and(z.object({
	sortBy: metagameSortBySchema.default('metaShare'),
	limit: z.coerce.number().int().min(1).max(500).optional(),
})).and(metagameConversionQuerySchema);

export const metagameArchetypeDetailQuerySchema = metagameCardTableQuerySchema.and(metagameConversionQuerySchema);

// Route params (reuse event params pattern)
export const metagameParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
});

export const metagameArchetypeParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	archetypeId: z.coerce.number().int().positive(),
});

export const metagameCardParamsSchema = z.object({
	id: z.coerce.number().int().positive(),
	cardId: z.coerce.number().int().positive(),
});

// ─── Inferred types ─────────────────────────────────────────────

export type MetagameQuery = z.infer<typeof metagameQuerySchema>;
export type MetagameCardsQuery = z.infer<typeof metagameCardsQuerySchema>;
export type MetagameArchetypesQuery = z.infer<typeof metagameArchetypesQuerySchema>;
