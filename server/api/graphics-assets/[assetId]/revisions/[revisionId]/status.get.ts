import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';

/**
 * The facts describing one Graphic Asset Revision, without its bytes.
 *
 * #55 created this route and its sibling `content.get` in one commit and
 * guarded only that one, so a revision's bytes required a graphics author
 * session while the facts describing them required none. Nothing touched this
 * file between then and #172, which is why the gap outlived the ingestion work
 * that never went near it.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	return await graphicsAssetLibraryForEvent(event).inspectGraphicAssetRevision({
		assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
		revisionId: graphicAssetRevisionId(getRouterParam(event, 'revisionId') ?? ''),
	});
});
