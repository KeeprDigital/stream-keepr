import { z } from 'zod';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { GRAPHIC_ASSET_LIFECYCLE_ACTIONS } from '~~/shared/types/graphicsAsset';

const actionSchema = z.object({
	action: z.enum(GRAPHIC_ASSET_LIFECYCLE_ACTIONS),
}).strict();

/**
 * The Library Workspace's Retire, Trash, and Restore.
 *
 * The Graphics Asset Library is installation-wide, so any graphics author may
 * move any asset — but only a graphics author. Retiring or Trashing is a real
 * removal from discovery, and the session that did it is what the Evidence
 * Ledger records; an unauthenticated caller has no name to record and no
 * standing to make the decision.
 */
export default defineEventHandler(async (event) => {
	// Who moved the asset, for the Evidence ledger. A lifecycle change is a
	// person's decision, and the ledger is the only place it is recorded.
	const actor = await requireGraphicsAuthorSession(event);
	try {
		const { action } = await readValidatedBody(event, actionSchema.parse);
		const input = {
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
			actor,
		};
		const library = graphicsAssetLibraryForEvent(event);
		if (action === 'retire')
			return await library.retireGraphicAsset(input);
		if (action === 'trash')
			return await library.trashGraphicAsset(input);
		return await library.restoreGraphicAsset(input);
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
