import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

// This route belongs to the application's current trusted administrator
// surface. Add installation-admin authorization here when auth is introduced.
export default defineEventHandler(async (event) => {
	try {
		return await graphicsAssetLibraryForEvent(event).getCapacity();
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
