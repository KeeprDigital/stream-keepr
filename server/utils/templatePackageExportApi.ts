import type { H3Event } from 'h3';
import type { TemplatePackageExportOutcome } from '~~/server/modules/graphics-asset-library';

/**
 * The shared HTTP boundary for both Template Package exporters.
 *
 * An accepted export streams straight from the Graphics Asset Library, so the
 * route forwards a body it never buffers. A rejected export returns the one
 * complete report with stable codes; a report holding only retryable issues is a
 * `503` so a caller can try again, while an integrity or content problem is a
 * `409` the author has to correct.
 */
export function respondWithTemplatePackage(
	event: H3Event,
	outcome: TemplatePackageExportOutcome,
): ReadableStream<Uint8Array> {
	if (outcome.outcome === 'rejected') {
		const { report } = outcome;
		const retryable = report.issues.length > 0 && report.issues.every(issue => issue.retryable);
		if (retryable)
			setResponseHeader(event, 'retry-after', 5);
		throw createError({
			statusCode: retryable ? 503 : 409,
			statusMessage: retryable ? 'Service Unavailable' : 'Conflict',
			message: 'The Template Package could not be exported',
			data: report,
		});
	}

	const { package: envelope } = outcome;
	setResponseHeaders(event, {
		'content-type': envelope.mediaType,
		'content-length': envelope.archiveByteLength,
		'content-disposition': `attachment; filename="${envelope.fileName}"`,
		// A package is authored data assembled per request, never shared-cacheable.
		'cache-control': 'no-store',
	});
	return envelope.open();
}
