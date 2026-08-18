import type { GraphicsOperationsCockpitReading } from '~~/shared/types/graphicsAsset';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { graphicsActorNames } from '~~/server/utils/actorNames';
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
export default defineEventHandler(async (event): Promise<GraphicsOperationsCockpitReading> => {
	try {
		await requireGraphicsAdministrator(event);
		const cockpit = await graphicsAssetLibraryForEvent(event).getOperationsCockpit();

		// Who started each waiting operation, resolved here rather than stored
		// beside the id (#398, ADR-0010). The catalogue-unavailable reading names
		// nobody because it carries no operations to name — an empty naming is the
		// accurate answer there, not a missing one.
		return {
			...cockpit,
			actorNames: await graphicsActorNames(
				cockpit.outcome === 'complete'
					? cockpit.ingestion.operations.map(operation => operation.initiatedBy)
					: [],
			),
		};
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
