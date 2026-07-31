import { z } from 'zod';
import {
	GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES,
	GRAPHICS_ASSET_EVIDENCE_SUBJECT_KIND_VALUES,
} from '~~/server/db/schema/graphicsAsset';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The subject filter is one opaque domain identity, and both halves of it are
 * required together: a kind without an identity would silently widen the read
 * to every subject of that kind, which is a different question from the one an
 * inspector asks.
 */
const evidenceQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).optional(),
	category: z.union([
		z.enum(GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES),
		z.array(z.enum(GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES)),
	]).optional(),
	subjectKind: z.enum(GRAPHICS_ASSET_EVIDENCE_SUBJECT_KIND_VALUES).optional(),
	subjectId: z.string().min(1).max(200).optional(),
}).strict().refine(
	query => (query.subjectKind === undefined) === (query.subjectId === undefined),
	{ message: 'A subject filter needs both a subject kind and a subject identity' },
);

export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const query = await getValidatedQuery(event, evidenceQuerySchema.parse);
		return await graphicsAssetLibraryForEvent(event).listGraphicsAssetEvidence({
			limit: query.limit,
			categories: query.category === undefined
				? undefined
				: [query.category].flat(),
			subject: query.subjectKind === undefined || query.subjectId === undefined
				? undefined
				: { kind: query.subjectKind, id: query.subjectId },
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
