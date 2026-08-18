import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The installation's storage occupancy, as an author reads it.
 *
 * Changing a limit stays on the administrator surface behind the installation
 * admin token; reading one needs a session, because the figure describes the
 * installation rather than any one asset (#172).
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	try {
		return await graphicsAssetLibraryForEvent(event).getCapacity();
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
