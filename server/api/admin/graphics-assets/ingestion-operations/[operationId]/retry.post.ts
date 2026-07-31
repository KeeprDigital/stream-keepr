import type { GraphicsQueueActionOutcome } from '~~/shared/utils/graphicsOperationalQueues';
import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { graphicsQueueActionErrorOutcome } from '~~/server/utils/graphicsQueueActions';
import { graphicsIngestionRetryQueueOutcome } from '~~/shared/utils/graphicsOperationalQueues';

/**
 * A Graphics Ingestion Operation stays owned by the author who started it, and
 * the library scopes every read and every durable claim by that owner. An
 * administrator resuming one from a queue therefore names the owner rather than
 * taking it over: the operation, its retained input, and its eventual result
 * all remain the author's. A name that does not own the operation resolves to
 * nothing, which is the same safe answer the author-facing route gives.
 */
const retrySchema = z.object({
	initiatedBy: z.string().min(1).max(200),
}).strict();

/**
 * Resumes one Graphics Ingestion Operation from its retained verified input.
 *
 * Retry is idempotent by construction: a terminal operation is returned
 * unchanged, and an operation whose staged input has expired cannot be resumed
 * at all. Both report `already-in-state` rather than a second success.
 */
export default defineEventHandler(async (event): Promise<{
	outcome: GraphicsQueueActionOutcome;
}> => {
	await requireGraphicsAdministrator(event);
	const { initiatedBy } = await readValidatedBody(event, retrySchema.parse);
	try {
		const operation = await graphicsAssetLibraryForEvent(event).retryGraphicsIngestion({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy,
		});
		return { outcome: graphicsIngestionRetryQueueOutcome(operation) };
	}
	catch (error) {
		const outcome = graphicsQueueActionErrorOutcome(error);
		if (outcome)
			return { outcome };
		return rethrowGraphicsAssetApiError(error, event);
	}
});
