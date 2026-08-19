import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

export default defineEventHandler(async (event) => {
	const initiatedBy = await requireUserId(event);
	try {
		return await graphicsAssetLibraryForEvent(event).cancelGraphicsIngestion({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
