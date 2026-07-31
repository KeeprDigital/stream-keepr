import { z } from 'zod';
import {
	GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES,
	GRAPHICS_ASSET_EVIDENCE_SUBJECT_KIND_VALUES,
} from '~~/server/db/schema/graphicsAsset';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import {
	GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES,
	graphicsEvidenceCategoriesForGroups,
} from '~~/shared/utils/graphicsAssetEvidence';

/**
 * One or many of the same query parameter. Repeating a parameter is how a
 * multi-select is sent, and a single value arrives unwrapped, so both shapes
 * have to answer the same question.
 */
function repeatable<Value extends string>(values: readonly [Value, ...Value[]]) {
	return z.union([z.enum(values), z.array(z.enum(values))]).optional();
}

/**
 * The subject filter is one opaque domain identity, and both halves of it are
 * required together: a kind without an identity would silently widen the read
 * to every subject of that kind, which is a different question from the one an
 * inspector asks. A cursor is the same — a position in the ledger is a recorded
 * instant and the entry that shared it, and half of one is not a position.
 */
const evidenceQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).optional(),
	category: repeatable(GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES),
	group: repeatable(GRAPHICS_EVIDENCE_CATEGORY_GROUP_VALUES),
	subjectKind: z.enum(GRAPHICS_ASSET_EVIDENCE_SUBJECT_KIND_VALUES).optional(),
	subjectId: z.string().min(1).max(200).optional(),
	actor: z.string().min(1).max(200).optional(),
	correlationId: z.string().min(1).max(200).optional(),
	recordedFrom: z.string().datetime().optional(),
	recordedUntil: z.string().datetime().optional(),
	cursorRecordedAt: z.string().datetime().optional(),
	cursorId: z.string().min(1).max(200).optional(),
	direction: z.enum(['older', 'newer']).optional(),
}).strict().refine(
	query => (query.subjectKind === undefined) === (query.subjectId === undefined),
	{ message: 'A subject filter needs both a subject kind and a subject identity' },
).refine(
	query => (query.cursorRecordedAt === undefined) === (query.cursorId === undefined),
	{ message: 'A ledger position needs both a recorded instant and an entry identity' },
);

/**
 * The chronological Evidence ledger, newest first.
 *
 * The ledger only grows, so it is never read whole: a page is bounded and is
 * addressed by the entry it ended on rather than by an offset, which would
 * re-read everything before it and shift under a sweep writing new entries
 * while the pages are being turned.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const query = await getValidatedQuery(event, evidenceQuerySchema.parse);
		// A group is a name for a set of categories, so asking by group and by
		// category is one question asked in two vocabularies rather than two
		// filters that would then have to agree with each other.
		const categories = [
			...(query.category === undefined ? [] : [query.category].flat()),
			...graphicsEvidenceCategoriesForGroups(
				query.group === undefined ? [] : [query.group].flat(),
			),
		];
		return await graphicsAssetLibraryForEvent(event).listGraphicsAssetEvidence({
			limit: query.limit,
			categories: categories.length === 0 ? undefined : [...new Set(categories)],
			subject: query.subjectKind === undefined || query.subjectId === undefined
				? undefined
				: { kind: query.subjectKind, id: query.subjectId },
			actor: query.actor,
			correlationId: query.correlationId,
			recordedFrom: query.recordedFrom,
			recordedUntil: query.recordedUntil,
			cursor: query.cursorRecordedAt === undefined || query.cursorId === undefined
				? undefined
				: { recordedAt: query.cursorRecordedAt, id: query.cursorId },
			direction: query.direction,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
