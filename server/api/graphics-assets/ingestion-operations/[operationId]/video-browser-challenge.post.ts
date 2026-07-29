import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';

/**
 * Starts the trusted application playback flow for one exact staged revision.
 *
 * The challenge proves operation/author/source/fact binding, freshness, and
 * single-use sequencing. Browser JavaScript cannot provide cryptographic
 * remote attestation of decoder execution, so authenticated author access is
 * the explicit trust boundary for the observed playback facts.
 */
export default defineEventHandler(async (event) => {
	try {
		return await graphicsAssetLibraryForEvent(event).issueSilentVideoBrowserChallenge({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy: graphicsAuthorIdentity(event),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
