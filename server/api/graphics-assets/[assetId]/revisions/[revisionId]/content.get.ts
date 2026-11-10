import type { H3Event } from 'h3';
import {
	graphicAssetId,
	graphicAssetRevisionId,
} from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireUserId } from '~~/server/utils/auth';
import {
	ifNoneMatchMatches,
	rangePermitted,
	requestedByteRange,
} from '~~/server/utils/byteRangeContentDelivery';
import { TemporarilyUnavailableError } from '~~/server/utils/errors';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';

/**
 * The one refusal every read answers when the byte store is out of reach.
 *
 * Shared between the metadata lookup and the byte read, whole or ranged, because
 * they are the same failure seen at different reads of the same store, and a twin
 * is the site most likely to drift. The cause is what carries the
 * sentence past the 5xx sanitizer; without it both answered 'Internal Server Error'
 * beside a retry-after header, which tells an operator to retry and not what for
 * (#321).
 */
function contentTemporarilyUnavailable(event: H3Event) {
	setResponseHeader(event, 'retry-after', 5);
	const cause = new TemporarilyUnavailableError('Graphic Asset Content is temporarily unavailable');
	return createError({
		statusCode: cause.statusCode,
		statusMessage: 'Service Unavailable',
		message: cause.message,
		cause,
	});
}

function revisionNotFound() {
	return createError({
		statusCode: 404,
		statusMessage: 'Not Found',
		message: 'Graphic Asset Revision not found',
	});
}

export default defineEventHandler(async (event) => {
	await requireUserId(event);
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
	try {
		const library = graphicsAssetLibraryForEvent(event);
		// The validator names the route, so it cannot vouch for a revision that
		// is gone: the revision is looked up before any conditional is answered.
		// The same lookup states the length a range is judged against, so a
		// ranged read opens only the bytes it serves.
		const inspection = await library.inspectGraphicAssetRevisionContent({ assetId, revisionId });
		if (inspection.outcome === 'missing')
			throw revisionNotFound();
		if (inspection.outcome === 'unavailable')
			throw contentTemporarilyUnavailable(event);
		if (ifNoneMatchMatches(getRequestHeader(event, 'if-none-match'), etag))
			return new Response(null, { status: 304, headers: baseHeaders });
		const range = rangePermitted(getRequestHeader(event, 'if-range'), etag)
			? requestedByteRange(getRequestHeader(event, 'range'), inspection.byteLength)
			: undefined;
		if (range === 'unsatisfiable') {
			return new Response(null, {
				status: 416,
				headers: {
					...baseHeaders,
					'content-range': `bytes */${inspection.byteLength}`,
				},
			});
		}
		const rangeLength = range
			? range.end - range.start + 1
			: undefined;
		const content = await library.resolveGraphicAssetRevision({
			assetId,
			revisionId,
			range: range && { offset: range.start, length: rangeLength! },
		});
		// The revision can leave between the lookup and the byte read.
		if (content.outcome === 'missing')
			throw revisionNotFound();
		if (content.outcome === 'unavailable')
			throw contentTemporarilyUnavailable(event);
		if (range) {
			return new Response(content.body, {
				status: 206,
				headers: {
					...baseHeaders,
					'content-type': content.contentType,
					'content-length': String(rangeLength),
					'content-range': `bytes ${range.start}-${range.end}/${inspection.byteLength}`,
				},
			});
		}
		return new Response(content.body, {
			headers: {
				...baseHeaders,
				'content-type': content.contentType,
				'content-length': String(content.byteLength),
			},
		});
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
