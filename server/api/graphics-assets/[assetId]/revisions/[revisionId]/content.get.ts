import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	try {
		const result = await graphicsAssetLibraryForEvent(event).resolveGraphicAssetRevision({
			assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
			revisionId: graphicAssetRevisionId(getRouterParam(event, 'revisionId') ?? ''),
		});
		if (result.outcome === 'missing') {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Graphic Asset Revision not found',
			});
		}
		if (result.outcome === 'unavailable') {
			setResponseHeader(event, 'retry-after', 5);
			throw createError({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphic Asset Content is temporarily unavailable',
			});
		}
		return new Response(result.body, {
			headers: {
				'content-type': result.contentType,
				'content-length': String(result.byteLength),
				'cache-control': 'private, no-store',
				'vary': 'cookie',
			},
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
