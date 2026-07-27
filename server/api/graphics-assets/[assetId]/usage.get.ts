import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';

export default defineEventHandler(async (event) => {
	return await graphicsAssetLibraryForEvent(event).listGraphicAssetUsage({
		assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
	});
});
