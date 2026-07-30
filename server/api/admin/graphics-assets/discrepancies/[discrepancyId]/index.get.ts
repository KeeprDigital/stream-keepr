import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsDiscrepancyId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		return await graphicsAssetLibraryForEvent(event).inspectGraphicsDiscrepancy({
			discrepancyId: graphicsDiscrepancyId(getRouterParam(event, 'discrepancyId') ?? ''),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
