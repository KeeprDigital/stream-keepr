import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The Library Workspace view of one Graphic Asset's exact recovery and cleanup
 * deadlines.
 *
 * Gated with the rest of the library's reads by #172, which closed the
 * asymmetry #90 left: writing to the library required a graphics author
 * session while reading all of it required nothing. The session is asked for
 * as authentication only — the library is deliberately installation-wide, so
 * the author it resolves is never compared against the asset, and any author
 * may read any asset's deadlines exactly as any author may retire it.
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
