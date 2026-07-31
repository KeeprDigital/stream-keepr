import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The one Operations Cockpit reading.
 *
 * It is a single composed answer rather than five surfaces the page stitches
 * together. This does not make the reading transactional — the catalogue reads
 * behind it are concurrent, not serialised — but it does bound the skew to the
 * milliseconds of one concurrently issued batch instead of the seconds a page
 * would accumulate across five sequential round trips. It also lets the reading
 * derive condition, alerts, and backlog from one `countOpenDiscrepancies()`
 * result, so those three can never contradict each other, which is the
 * inconsistency an administrator would actually notice.
 *
 * Inspecting and acting on an individual discrepancy, deadline, or Evidence
 * entry stays on the existing per-concern routes.
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
