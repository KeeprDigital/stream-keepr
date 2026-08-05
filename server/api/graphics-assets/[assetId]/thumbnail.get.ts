import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';

export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const result = await graphicsAssetLibraryForEvent(event).resolveGraphicAssetThumbnail({
		assetId: graphicAssetId(getRouterParam(event, 'assetId') ?? ''),
	});
	if (result.outcome === 'missing') {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Graphic Asset thumbnail not found',
		});
	}
	if (result.outcome === 'unavailable') {
		setResponseHeader(event, 'retry-after', 5);
		throw createError({
			statusCode: 503,
			statusMessage: 'Service Unavailable',
			message: 'Graphic Asset thumbnail is temporarily unavailable',
		});
	}
	return new Response(result.body, {
		headers: {
			'content-type': result.contentType,
			'content-length': String(result.byteLength),
			'cache-control': 'private, no-store',
		},
	});
});
