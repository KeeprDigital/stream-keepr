import { z } from 'zod';
import { GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES } from '~~/server/db/schema/graphicsAsset';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

const evidenceQuerySchema = z.object({
	limit: z.coerce.number().int().min(1).max(500).optional(),
	category: z.union([
		z.enum(GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES),
		z.array(z.enum(GRAPHICS_ASSET_EVIDENCE_CATEGORY_VALUES)),
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
