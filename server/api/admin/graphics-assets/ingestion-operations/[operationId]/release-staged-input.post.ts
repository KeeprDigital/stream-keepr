import type { GraphicsQueueActionOutcome } from '~~/shared/utils/graphicsOperationalQueues';
import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAdministratorActor,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';
import { graphicsQueueActionErrorOutcome } from '~~/server/utils/graphicsQueueActions';

/**
 * Retries the release of staged objects a failed sweep release stranded (#358)
 * — the unreleased-staged-input queue's one action, and the immediate manual
 * path beside the sweep that retries the same release every pass.
 *
 * The library proves the strand afresh from its own accounting (a terminal
 * operation still holding staging bytes), releases the same complete staged
 * object set the original release would have, zeroes the bytes only once the
 * delete landed, and records `staged-input-released` Evidence naming this
 * administrator as actor. Idempotent: a second run answers `already-in-state`.
 */
export default defineEventHandler(async (event): Promise<{
	outcome: GraphicsQueueActionOutcome;
}> => {
	try {
		await requireGraphicsAdministrator(event);
		const operationId = graphicsIngestionOperationId(
			getRouterParam(event, 'operationId') ?? '',
		);
		const library = graphicsAssetLibraryForEvent(event);
		const released = await library.releaseStrandedStagedInput({
			operationId,
			actor: await graphicsAdministratorActor(event),
		});
		return { outcome: released.outcome };
	}
	catch (error) {
		const outcome = graphicsQueueActionErrorOutcome(error);
		if (outcome)
			return { outcome };
		return rethrowGraphicsAssetApiError(error, event);
	}
});
