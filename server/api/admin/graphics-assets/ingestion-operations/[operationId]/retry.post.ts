import type { GraphicsQueueActionOutcome } from '~~/shared/utils/graphicsOperationalQueues';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { graphicsQueueActionErrorOutcome } from '~~/server/utils/graphicsQueueActions';
import { graphicsIngestionRetryQueueOutcome } from '~~/shared/utils/graphicsOperationalQueues';

/**
 * Resumes one Graphics Ingestion Operation from its retained verified input.
 *
 * The operation stays owned by the author who started it: the library scopes
 * every read and every durable claim by that owner, and an administrator
 * resuming one from a queue is not taking it over. The owner is therefore read
 * from the operation record rather than named by the caller, so no identity in
 * the request can disagree with the one the library holds.
 *
 * Retry is idempotent by construction. A terminal operation is returned
 * unchanged, and one whose staged input has expired cannot be resumed at all;
 * both report `already-in-state` rather than a second success.
 */
export default defineEventHandler(async (event): Promise<{
	outcome: GraphicsQueueActionOutcome;
}> => {
	try {
		await requireGraphicsAdministrator(event);
		const operationId = graphicsIngestionOperationId(
			getRouterParam(event, 'operationId') ?? '',
		);
		const library = graphicsAssetLibraryForEvent(event);
		const queued = await library.findQueuedIngestionOperation({ operationId });
		if (!queued) {
			// Nothing unfinished under that identity: already published, cancelled,
			// or swept away. Retrying it is the idempotent no-op it looks like.
			return { outcome: 'already-in-state' };
		}
		return {
			outcome: graphicsIngestionRetryQueueOutcome(
				await library.retryGraphicsIngestion({
					operationId,
					initiatedBy: queued.initiatedBy,
				}),
			),
		};
	}
	catch (error) {
		const outcome = graphicsQueueActionErrorOutcome(error);
		if (outcome)
			return { outcome };
		return rethrowGraphicsAssetApiError(error, event);
	}
});
