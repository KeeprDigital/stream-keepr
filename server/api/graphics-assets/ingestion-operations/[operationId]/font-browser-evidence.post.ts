import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { staticFontBrowserEvidenceSchema } from '~~/server/utils/graphicsBrowserEvidence';

export default defineEventHandler(async (event) => {
	const initiatedBy = await requireGraphicsAuthorSession(event);
	try {
		const evidence = await readValidatedBody(event, staticFontBrowserEvidenceSchema.parse);
		return await graphicsAssetLibraryForEvent(event).confirmFontBrowserEvidence({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy,
			evidence,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
