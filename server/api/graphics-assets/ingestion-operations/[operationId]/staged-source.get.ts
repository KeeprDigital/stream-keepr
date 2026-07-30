import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';

/**
 * Provisional staged bytes for an operation paused awaiting browser
 * confirmation. An approved remote copy has no client-side source file, so the
 * initiating author reads the exact staged bytes here to produce decode or font
 * evidence. The bytes stay private, uncacheable, and scoped to one operation.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	try {
		const staged = await graphicsAssetLibraryForEvent(event).resolveStagedGraphicAssetSource({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy: graphicsAuthorIdentity(event),
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
			throw createError({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Staged Graphic Asset source bytes are temporarily unavailable',
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
