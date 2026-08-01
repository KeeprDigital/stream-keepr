import { requireGraphicsAdministrator } from '~~/server/modules/graphics-administrator';
import { graphicsDiscrepancyId } from '~~/server/modules/graphics-asset-library';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { graphicsAdministratorActor, rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { getBoundedRequestBodyStream } from '~~/server/utils/payloadLimits';
import { MAX_SILENT_VIDEO_INGESTION_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

/**
 * Exact-byte repair of Unavailable Graphic Asset Content.
 *
 * The route streams without buffering and never chooses what the bytes must be:
 * the expected length comes from the discrepancy the catalogue already holds,
 * and the library proves the digest, size, canonical media type, and validation
 * facts before a byte reaches canonical storage.
 */
export default defineEventHandler(async (event) => {
	try {
		await requireGraphicsAdministrator(event);
		const library = graphicsAssetLibraryForEvent(event);
		const discrepancyId = graphicsDiscrepancyId(getRouterParam(event, 'discrepancyId') ?? '');
		const discrepancy = await library.inspectGraphicsDiscrepancy({ discrepancyId });
		const body = getBoundedRequestBodyStream(event);
		if (!body) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Bad Request',
				message: 'Repair content is required',
			});
		}
		return await library.repairUnavailableGraphicAssetContent({
			discrepancyId,
			actor: await graphicsAdministratorActor(event),
			bytes: createBoundedByteStream(body, {
				byteLength: discrepancy.expected.byteLength,
				maximumByteLength: MAX_SILENT_VIDEO_INGESTION_BYTES,
			}),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
