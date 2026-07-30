import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';
import { graphicAssetBrowserEvidenceSchema } from '~~/server/utils/graphicsBrowserEvidence';

export default defineEventHandler(async (event) => {
	try {
		const evidence = await readValidatedBody(
			event,
			graphicAssetBrowserEvidenceSchema.parse,
		);
		return await graphicsAssetLibraryForEvent(event).confirmGraphicAssetBrowserEvidence({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy: graphicsAuthorIdentity(event),
			evidence,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
