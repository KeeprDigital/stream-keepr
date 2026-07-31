import { z } from 'zod';
import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { graphicsAuthorIdentity, rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { GRAPHIC_ASSET_LIFECYCLE_ACTIONS } from '~~/shared/types/graphicsAsset';

const actionSchema = z.object({
	action: z.enum(GRAPHIC_ASSET_LIFECYCLE_ACTIONS),
}).strict();

export default defineEventHandler(async (event) => {
	try {
		const { action } = await readValidatedBody(event, actionSchema.parse);
		const input = {
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
			// Who moved the asset, for the Evidence ledger. A lifecycle change is
			// a person's decision, and the ledger is the only place it is recorded.
			actor: graphicsAuthorIdentity(event),
		};
		const library = graphicsAssetLibraryForEvent(event);
		if (action === 'retire')
			return await library.retireGraphicAsset(input);
		if (action === 'trash')
			return await library.trashGraphicAsset(input);
		return await library.restoreGraphicAsset(input);
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
