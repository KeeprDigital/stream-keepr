import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Runs the retention path on demand. The scheduled trigger runs the identical
 * pass, so this only ever brings work forward to the same guarantees; it cannot
 * shorten a deadline.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		return await graphicsAssetLibraryForEvent(event).runGraphicsRetention();
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
