import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import {
	ifNoneMatchMatches,
	rangePermitted,
	requestedByteRange,
} from '~~/server/utils/byteRangeContentDelivery';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const assetId = graphicAssetId(getRouterParam(event, 'assetId') ?? '');
	const revisionId = graphicAssetRevisionId(getRouterParam(event, 'revisionId') ?? '');
	// Revisions are immutable, so their route identity is a strong validator
	// for conditional and ranged reads without exposing any provider detail.
	const etag = `"sk-revision-${assetId}-${revisionId}"`;
	const baseHeaders = {
		'accept-ranges': 'bytes',
		'cache-control': 'private, max-age=0, must-revalidate',
		'etag': etag,
		'vary': 'cookie',
	} as const;
	if (ifNoneMatchMatches(getRequestHeader(event, 'if-none-match'), etag))
		return new Response(null, { status: 304, headers: baseHeaders });
	try {
		const library = graphicsAssetLibraryForEvent(event);
		const complete = await library.resolveGraphicAssetRevision({ assetId, revisionId });
		if (complete.outcome === 'missing') {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Graphic Asset Revision not found',
			});
		}
		if (complete.outcome === 'unavailable') {
			setResponseHeader(event, 'retry-after', 5);
			throw createError({
				statusCode: 503,
				statusMessage: 'Service Unavailable',
				message: 'Graphic Asset Content is temporarily unavailable',
			});
		}
		const range = rangePermitted(getRequestHeader(event, 'if-range'), etag)
			? requestedByteRange(getRequestHeader(event, 'range'), complete.byteLength)
			: undefined;
		if (range === 'unsatisfiable') {
			await complete.body.cancel();
			return new Response(null, {
				status: 416,
				headers: {
					...baseHeaders,
					'content-range': `bytes */${complete.byteLength}`,
				},
			});
		}
		if (range) {
			await complete.body.cancel();
			const rangeLength = range.end - range.start + 1;
			const partial = await library.resolveGraphicAssetRevision({
				assetId,
				revisionId,
				range: { offset: range.start, length: rangeLength },
			});
			if (partial.outcome !== 'available') {
				setResponseHeader(event, 'retry-after', 5);
				throw createError({
					statusCode: 503,
					statusMessage: 'Service Unavailable',
					message: 'Graphic Asset Content is temporarily unavailable',
				});
			}
			return new Response(partial.body, {
				status: 206,
				headers: {
					...baseHeaders,
					'content-type': partial.contentType,
					'content-length': String(rangeLength),
					'content-range': `bytes ${range.start}-${range.end}/${complete.byteLength}`,
				},
			});
		}
		return new Response(complete.body, {
			headers: {
				...baseHeaders,
				'content-type': complete.contentType,
				'content-length': String(complete.byteLength),
			},
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
