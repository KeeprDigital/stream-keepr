import { z } from 'zod';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

const actionSchema = z.object({
	action: z.enum(['retire', 'trash', 'restore']),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		const { action } = await readValidatedBody(event, actionSchema.parse);
		const input = {
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
		};
		const library = graphicsAssetLibraryForEvent(event);
		if (action === 'retire')
			return await library.retireGraphicAsset(input);
		if (action === 'trash')
			return await library.trashGraphicAsset(input);
		return await library.restoreGraphicAsset(input);
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
