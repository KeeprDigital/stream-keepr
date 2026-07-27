import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';

export default defineEventHandler(async (event) => {
	return await graphicsAssetLibraryForEvent(event).inspectGraphicAssetRevision({
		assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
		revisionId: graphicAssetRevisionId(getRouterParam(event, 'revisionId') ?? ''),
	});
});
