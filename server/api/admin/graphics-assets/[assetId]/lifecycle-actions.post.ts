import type { GraphicsQueueActionOutcome } from '~~/shared/utils/graphicsOperationalQueues';
import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { graphicsAuthorIdentity, rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { graphicsQueueActionErrorOutcome } from '~~/server/utils/graphicsQueueActions';
import { graphicsLifecycleQueueOutcome } from '~~/shared/utils/graphicsOperationalQueues';

/**
 * Restoration is the only lifecycle action any queue offers, so it is the only
 * one this route accepts. Retiring and Trashing an asset are the Library
 * Workspace's decisions about a live asset; an administrator working a queue is
 * bringing one back from Retired or from Trash. Accepting the other two here
 * would be mutation surface nothing calls.
 */
const actionSchema = z.object({
	action: z.literal('restore'),
}).strict();

/**
 * The administrator-gated restoration the operational queues offer.
 *
 * It drives the same library method the Library Workspace does and decides no
 * transition the library would not have decided anyway. It exists because the
 * queues are an administrator surface and must be gated like every other one
 * under `/api/admin`, and because a queue action reports the explicit outcome
 * vocabulary rather than a status the caller has to interpret.
 */
export default defineEventHandler(async (event): Promise<{
	outcome: GraphicsQueueActionOutcome;
}> => {
	try {
		await requireGraphicsAdministrator(event);
		await readValidatedBody(event, actionSchema.parse);
		return {
			outcome: graphicsLifecycleQueueOutcome(
				await graphicsAssetLibraryForEvent(event).restoreGraphicAsset({
					assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
					actor: graphicsAuthorIdentity(event),
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
