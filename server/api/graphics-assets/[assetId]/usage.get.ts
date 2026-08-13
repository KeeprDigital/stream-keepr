import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Which Screens and Events reference one Graphic Asset.
 *
 * The sharpest of the library's reads, and why #172 was not only about the
 * asset library: the answer names Screens and Events by id, so it describes the
 * shape of the installation rather than the asset that was asked about.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	try {
		return await graphicsAssetLibraryForEvent(event).listGraphicAssetUsage({
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
