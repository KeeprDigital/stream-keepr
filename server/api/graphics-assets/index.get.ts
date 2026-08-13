import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { graphicAssetListQuerySchema } from '~~/server/schemas/api/graphicsAsset';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Discovery across the whole Graphics Asset Library.
 *
 * The listing is installation-wide by design — `CONTEXT.md` has graphics
 * authors discovering and referencing every Graphic Asset — so the session is
 * asked for as authentication and never consulted again. #172 closed the
 * asymmetry #90 left: writing to the library required a session while reading
 * all of it required nothing.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	try {
		const { search, lifecycleStates } = await getValidatedQuery(
			event,
			graphicAssetListQuerySchema.parse,
		);
		return await graphicsAssetLibraryForEvent(event).listGraphicAssets({
			search,
			lifecycleStates,
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
