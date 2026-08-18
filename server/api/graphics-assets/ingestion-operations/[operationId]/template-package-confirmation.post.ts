import { z } from 'zod';
import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The fingerprint is required rather than optional: confirming without naming
 * the exact report being accepted is how an author ends up installing a proposal
 * they never saw.
 */
const confirmationSchema = z.object({
	fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export default defineEventHandler(async (event) => {
	const initiatedBy = await requireUserId(event);
	try {
		const { fingerprint } = await readValidatedBody(event, confirmationSchema.parse);
		return await graphicsAssetLibraryForEvent(event).confirmTemplatePackagePreflight({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy,
			fingerprint,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
