import { z } from 'zod';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { graphicsAdministratorActor, rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

const purgeSchema = z.object({
	confirmation: z.literal('purge-now'),
}).strict();

/**
 * Explicit early purge of unreferenced Trash. It requires an administrator, a
 * literal confirmation, and a fresh all-revision reference proof.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const { confirmation } = await readValidatedBody(event, purgeSchema.parse);
		return await graphicsAssetLibraryForEvent(event).purgeTrashedGraphicAsset({
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
			actor: await graphicsAdministratorActor(event),
			confirmation,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
