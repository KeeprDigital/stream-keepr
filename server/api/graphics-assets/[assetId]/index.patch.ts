import { z } from 'zod';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

const metadataSchema = z.object({
	name: z.string().trim().min(1).max(200),
	eventIds: z.array(z.number().int().positive()).max(100),
}).strict();

/**
 * The Library Workspace's rename and Event re-association.
 *
 * Installation-wide like the lifecycle actions, so any graphics author may edit
 * any active asset — but only a graphics author. The Event set is replaced
 * rather than merged and carries no lower bound, so an empty array is a valid
 * request that detaches the asset from every Event it belongs to; that is a
 * decision, and a caller with no session has no standing to make it.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	try {
		const input = await readValidatedBody(event, metadataSchema.parse);
		return await graphicsAssetLibraryForEvent(event).updateGraphicAsset({
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
			...input,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
