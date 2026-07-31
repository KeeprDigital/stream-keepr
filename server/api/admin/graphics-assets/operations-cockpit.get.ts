import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The one Operations Cockpit reading.
 *
 * It is a single composed answer rather than five surfaces the page stitches
 * together, because a cockpit assembled from independently timed reads would
 * show a torn picture — a quota from one instant beside a backlog from another —
 * exactly when an administrator most needs a coherent one. Inspecting and acting
 * on an individual discrepancy, deadline, or Evidence entry stays on the
 * existing per-concern routes.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		return await graphicsAssetLibraryForEvent(event).getOperationsCockpit();
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
