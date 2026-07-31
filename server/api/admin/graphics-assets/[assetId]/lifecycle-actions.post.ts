import type { GraphicsQueueActionOutcome } from '~~/shared/utils/graphicsOperationalQueues';
import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { graphicsQueueActionErrorOutcome } from '~~/server/utils/graphicsQueueActions';
import { GRAPHIC_ASSET_LIFECYCLE_ACTIONS } from '~~/shared/types/graphicsAsset';
import { graphicsLifecycleQueueOutcome } from '~~/shared/utils/graphicsOperationalQueues';

const actionSchema = z.object({
	action: z.enum(GRAPHIC_ASSET_LIFECYCLE_ACTIONS),
}).strict();

/**
 * The administrator-gated lifecycle actions the operational queues offer.
 *
 * The Library Workspace drives the same library methods through its own
 * author-facing route. This one exists because the queues are an administrator
 * surface and must be gated like every other one under `/api/admin`, and
 * because a queue action reports the explicit outcome vocabulary rather than a
 * status the caller has to interpret. It decides no transition the library
 * would not have decided anyway.
 */
export default defineEventHandler(async (event): Promise<{
	outcome: GraphicsQueueActionOutcome;
}> => {
	await requireGraphicsAdministrator(event);
	const { action } = await readValidatedBody(event, actionSchema.parse);
	const input = { assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? '') };
	const library = graphicsAssetLibraryForEvent(event);
	try {
		if (action === 'retire')
			return { outcome: graphicsLifecycleQueueOutcome(await library.retireGraphicAsset(input)) };
		if (action === 'trash')
			return { outcome: graphicsLifecycleQueueOutcome(await library.trashGraphicAsset(input)) };
		return { outcome: graphicsLifecycleQueueOutcome(await library.restoreGraphicAsset(input)) };
	}
	catch (error) {
		const outcome = graphicsQueueActionErrorOutcome(error);
		if (outcome)
			return { outcome };
		return rethrowGraphicsAssetApiError(error, event);
	}
});
