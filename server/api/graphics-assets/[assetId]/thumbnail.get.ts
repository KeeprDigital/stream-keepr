import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';

/**
 * One Graphic Asset's rendered thumbnail.
 *
 * Gated with the rest of the library's reads by #172, which closed the
 * asymmetry #90 left: writing to the library required a graphics author
 * session while reading all of it required nothing. The session is asked for
 * as authentication only — the library is deliberately installation-wide, so
 * the author it resolves is never compared against the asset.
 *
 * The browser sends the session cookie with the `<img>` request itself; there
 * is no server-side render to forward it, because `nuxt.config.ts` sets
 * `ssr: false`.
 */
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
