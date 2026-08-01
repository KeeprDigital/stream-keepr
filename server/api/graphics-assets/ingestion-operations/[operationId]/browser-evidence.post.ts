import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { graphicAssetBrowserEvidenceSchema } from '~~/server/utils/graphicsBrowserEvidence';

export default defineEventHandler(async (event) => {
	const initiatedBy = await requireGraphicsAuthorSession(event);
	try {
		const evidence = await readValidatedBody(
			event,
			graphicAssetBrowserEvidenceSchema.parse,
		);
		return await graphicsAssetLibraryForEvent(event).confirmGraphicAssetBrowserEvidence({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy,
			evidence,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
