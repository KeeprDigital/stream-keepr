import { graphicAssetId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { TemporarilyUnavailableError } from '~~/server/utils/errors';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

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
	try {
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
			// The cause is what carries this sentence past the 5xx sanitizer; without
			// it the operator reads 'Internal Server Error' beside a retry-after header
			// and cannot tell a store that went away from a server that broke (#321).
			const cause = new TemporarilyUnavailableError('Graphic Asset thumbnail is temporarily unavailable');
			throw createError({
				statusCode: cause.statusCode,
				statusMessage: 'Service Unavailable',
				message: cause.message,
				cause,
			});
		}
		return new Response(result.body, {
			headers: {
				'content-type': result.contentType,
				'content-length': String(result.byteLength),
				'cache-control': 'private, no-store',
			},
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
