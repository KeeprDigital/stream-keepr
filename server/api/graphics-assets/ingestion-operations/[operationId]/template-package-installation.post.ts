import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Installs one confirmed Template Package.
 *
 * The route carries no proposal of its own: what installs is exactly the report
 * the author confirmed, and the library proves that report still describes this
 * package before publishing anything. Posting twice is the same act twice, so a
 * client that lost a response asks again rather than installing a second copy.
 */
export default defineEventHandler(async (event) => {
	const initiatedBy = await requireUserId(event);
	try {
		return await graphicsAssetLibraryForEvent(event).installTemplatePackage({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
