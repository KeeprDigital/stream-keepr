import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { TemporarilyUnavailableError } from '~~/server/utils/errors';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * Provisional staged bytes for an operation paused awaiting browser
 * confirmation. An approved remote copy has no client-side source file, so the
 * initiating author reads the exact staged bytes here to produce decode or font
 * evidence. The bytes stay private, uncacheable, and scoped to one operation.
 */
export default defineEventHandler(async (event) => {
	const initiatedBy = await requireGraphicsAuthorSession(event);
	try {
		const staged = await graphicsAssetLibraryForEvent(event).resolveStagedGraphicAssetSource({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy,
		});
		if (staged.outcome === 'missing') {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'No staged Graphic Asset source is awaiting confirmation',
			});
		}
		if (staged.outcome === 'unavailable') {
			setResponseHeader(event, 'retry-after', 5);
			// The cause is what carries this sentence past the 5xx sanitizer; without it
			// the author waiting to confirm an ingestion reads 'Internal Server Error'
			// and cannot tell a staging store that went away from a broken server (#321).
			const cause = new TemporarilyUnavailableError('Staged Graphic Asset source bytes are temporarily unavailable');
			throw createError({
				statusCode: cause.statusCode,
				statusMessage: 'Service Unavailable',
				message: cause.message,
				cause,
			});
		}
		return new Response(staged.body, {
			headers: {
				'content-type': 'application/octet-stream',
				'content-length': String(staged.byteLength),
				'cache-control': 'private, no-store',
				'vary': 'cookie',
			},
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
