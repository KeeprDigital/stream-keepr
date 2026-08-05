import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The Library Workspace view of one Graphic Asset's exact recovery and cleanup
 * deadlines.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	try {
		return await graphicsAssetLibraryForEvent(event).inspectGraphicAssetRetention({
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
