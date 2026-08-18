import { z } from 'zod';
import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The approved remote source URL is supplied per attempt and never persisted:
 * its query parameters and fragment are treated as secrets, so this route must
 * not log the body or echo the URL in any response.
 */
const remoteCopySchema = z.object({
	sourceUrl: z.string().min(1).max(2048),
}).strict();

export default defineEventHandler(async (event) => {
	const initiatedBy = await requireUserId(event);
	try {
		const { sourceUrl } = await readValidatedBody(event, remoteCopySchema.parse);
		return await graphicsAssetLibraryForEvent(event).copyRemoteGraphicAssetSource({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy,
			sourceUrl,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
