import { z } from 'zod';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

const metadataSchema = z.object({
	name: z.string().trim().min(1).max(200),
	eventIds: z.array(z.number().int().positive()).max(100),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		const input = await readValidatedBody(event, metadataSchema.parse);
		return await graphicsAssetLibraryForEvent(event).updateGraphicAsset({
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
			...input,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
