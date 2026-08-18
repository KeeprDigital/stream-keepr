import {
	graphicsIngestionOperationId,
	graphicsMultipartPartByteLength,
} from '~~/server/modules/graphics-asset-library';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { getBoundedRequestBodyStream } from '~~/server/utils/payloadLimits';
import { GRAPHICS_MULTIPART_PART_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

export default defineEventHandler(async (event) => {
	const initiatedBy = await requireUserId(event);
	try {
		const library = graphicsAssetLibraryForEvent(event);
		const operationId = graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? '');
		const operation = await library.getIngestionOperation({ operationId, initiatedBy });
		const partNumber = Number(getRouterParam(event, 'partNumber'));
		const byteLength = graphicsMultipartPartByteLength(
			operation.declaredByteLength,
			partNumber,
		);
		const body = getBoundedRequestBodyStream(event);
		if (!body) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Bad Request',
				message: 'Multipart part body is required',
			});
		}
		return await library.uploadGraphicAssetMultipartPart({
			operationId,
			initiatedBy,
			partNumber,
			bytes: createBoundedByteStream(body, {
				byteLength,
				maximumByteLength: GRAPHICS_MULTIPART_PART_BYTES,
			}),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
