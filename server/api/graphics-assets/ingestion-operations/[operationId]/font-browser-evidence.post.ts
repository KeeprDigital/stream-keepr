import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';
import { staticFontBrowserEvidenceSchema } from '~~/server/utils/graphicsBrowserEvidence';

export default defineEventHandler(async (event) => {
	try {
		const evidence = await readValidatedBody(event, staticFontBrowserEvidenceSchema.parse);
		return await graphicsAssetLibraryForEvent(event).confirmFontBrowserEvidence({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy: graphicsAuthorIdentity(event),
			evidence,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
