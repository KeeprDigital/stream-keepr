import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Every operational queue in one risk-ordered reading. Each queue reports its
 * complete count as an aggregate and carries a bounded, deadline-ordered
 * sample, so one reading's size does not grow with the backlog.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		return await graphicsAssetLibraryForEvent(event).getOperationalQueues();
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
