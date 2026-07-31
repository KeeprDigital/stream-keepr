import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Catalogue-versus-byte-store health, every open discrepancy, and the exact
 * actions valid for each. It states the authority contract explicitly so no
 * reader has to infer whether the catalogue flag or the byte store wins.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		return await graphicsAssetLibraryForEvent(event).getReconciliationOverview();
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
