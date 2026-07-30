import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { GRAPHICS_RETENTION_EVIDENCE_CATEGORIES } from '~~/shared/utils/graphicsAssetRetention';

const evidenceQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).optional(),
	category: z.union([
		z.enum(GRAPHICS_RETENTION_EVIDENCE_CATEGORIES),
		z.array(z.enum(GRAPHICS_RETENTION_EVIDENCE_CATEGORIES)),
	]).optional(),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const query = await getValidatedQuery(event, evidenceQuerySchema.parse);
		return await graphicsAssetLibraryForEvent(event).listGraphicsAssetEvidence({
			limit: query.limit,
			categories: query.category === undefined
				? undefined
				: [query.category].flat(),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
