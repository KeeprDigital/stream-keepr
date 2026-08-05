import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';

/**
 * The facts describing one Graphic Asset Revision, without its bytes.
 *
 * Guarded alongside its sibling `content.get`, which #90 guarded and this was
 * left behind by: the same revision's bytes required a session while the facts
 * describing them required none.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	return await graphicsAssetLibraryForEvent(event).inspectGraphicAssetRevision({
		assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
		revisionId: graphicAssetRevisionId(getRouterParam(event, 'revisionId') ?? ''),
	});
});
