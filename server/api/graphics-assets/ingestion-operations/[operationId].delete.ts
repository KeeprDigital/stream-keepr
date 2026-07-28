import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';

export default defineEventHandler(async (event) => {
	try {
		return await graphicsAssetLibraryForEvent(event).cancelImageIngestion({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy: graphicsAuthorIdentity(event),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
