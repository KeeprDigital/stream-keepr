import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { createBoundedByteStream } from '~~/server/modules/graphics-asset-library/object-store';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';
import { getBoundedRequestBodyStream } from '~~/server/utils/payloadLimits';
import { MAX_PNG_INGESTION_BYTES } from '~~/shared/utils/graphicsAssetCompatibility';

export default defineEventHandler(async (event) => {
	try {
		const library = graphicsAssetLibraryForEvent(event);
		const operationId = graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? '');
		const initiatedBy = graphicsAuthorIdentity(event);
		const operation = await library.getIngestionOperation({ operationId, initiatedBy });
		const declaredContentType = getHeader(event, 'content-type')
			?.split(';', 1)[0]
			?.trim()
			.toLocaleLowerCase();
		if (declaredContentType && declaredContentType !== 'image/png') {
			throw createError({
				statusCode: 415,
				statusMessage: 'Unsupported Media Type',
				message: 'Declared content type must be image/png',
			});
		}
		const body = getBoundedRequestBodyStream(event);
		if (!body) {
			throw createError({
				statusCode: 400,
				statusMessage: 'Bad Request',
				message: 'PNG transfer body is required',
			});
		}
		return await library.uploadPng({
			operationId,
			initiatedBy,
			bytes: createBoundedByteStream(body, {
				byteLength: operation.declaredByteLength,
				maximumByteLength: MAX_PNG_INGESTION_BYTES,
			}),
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error);
	}
});
