import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

export default defineEventHandler(async (event) => {
	try {
		return await graphicsAssetLibraryForEvent(event).getCapacity();
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
