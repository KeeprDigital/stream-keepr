import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Runs the reconciliation pass on demand. The scheduled trigger runs the
 * identical comparison, so this only ever brings an observation forward; it
 * cannot change what the catalogue expects or what the byte store holds.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		return await graphicsAssetLibraryForEvent(event).runGraphicsReconciliation();
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
