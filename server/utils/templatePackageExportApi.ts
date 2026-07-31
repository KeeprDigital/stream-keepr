import type { H3Event } from 'h3';
import type { TemplatePackageExportOutcome } from '~~/server/modules/graphics-asset-library';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { broadcastGraphicTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';

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

/**
 * One authored Broadcast Graphic as a `.skgraphic` Template Package.
 *
 * Two routes reach a Broadcast Graphic worth packaging by different paths — a
 * library entry by its own identity, a placed graphic through its Screen — and from
 * there the act is identical: discover what the design requires, hand it to the one
 * Graphics Asset Library export contract, and stream what comes back. Sharing it
 * means the two can never come to package the same design differently.
 */
export function exportBroadcastGraphicTemplatePackage(
	event: H3Event,
	template: {
		identity: string;
		name: string;
		/** Present where the exporting workflow manages one; provenance, never a link. */
		revision?: number;
		document: BroadcastGraphicConfig;
	},
): Promise<ReadableStream<Uint8Array>> {
	const requirements = broadcastGraphicTemplatePackageRequirements(template.document);
	return graphicsAssetLibraryForEvent(event)
		.exportTemplatePackage({
			packageKind: 'skgraphic',
			template,
			assets: requirements.assets,
			capabilities: requirements.capabilities,
		})
		.then(outcome => respondWithTemplatePackage(event, outcome))
		.catch(error => rethrowGraphicsAssetApiError(error, event));
}
