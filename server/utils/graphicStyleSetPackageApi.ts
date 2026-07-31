import type { H3Event } from 'h3';
import type { GraphicStyleSetPackageExportOutcome, GraphicStyleSetPackageInstallPorts } from '~~/server/modules/graphic-style-set-package';
import type { InstalledGraphicStyleSetFacts } from '~~/shared/modules/graphic-style-sets';
import { affectedTemplates } from '~~/server/modules/graphic-style-set';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { getBoundedRequestBodyStream, payloadTooLarge } from '~~/server/utils/payloadLimits';
import { resolveGraphicStyleSet, sameGraphicStyleValue } from '~~/shared/modules/graphic-style-sets';
import { GRAPHIC_STYLE_SET_PACKAGE_LIMITS } from '~~/shared/types/graphicStyleSetPackage';
import { randomUuid } from '~~/shared/utils/uuid';

/**
 * The HTTP boundary for the Graphic Style Set Package workflow: reading a received
 * archive, answering an export, and wiring the installation's own library into the
 * ports the package module is written against.
 */

const RECEIVED_PACKAGE_LABEL = 'Graphic Style Set Package';

/**
 * The received archive, bounded as its bytes arrive.
 *
 * The mutation body-limit middleware already caps the request at this route's declared
 * ceiling; this counts again while draining because the middleware's transform and this
 * buffer are the two places the bytes exist, and a route that trusted the first would
 * be one route rule away from an unbounded allocation.
 */
export async function readGraphicStyleSetPackageBody(event: H3Event): Promise<Uint8Array> {
	const maximum = GRAPHIC_STYLE_SET_PACKAGE_LIMITS.maximumArchiveByteLength;
	const stream = getBoundedRequestBodyStream(event);
	if (!stream) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: 'A Graphic Style Set Package must be sent as the request body',
		});
	}

	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done)
				break;
			totalBytes += value.byteLength;
			if (totalBytes > maximum) {
				try {
					await reader.cancel();
				}
				catch {
					// The 413 is authoritative; transport cleanup is best-effort.
				}
				payloadTooLarge(maximum, RECEIVED_PACKAGE_LABEL);
			}
			chunks.push(value);
		}
	}
	finally {
		reader.releaseLock();
	}

	if (totalBytes === 0) {
		throw createError({
			statusCode: 400,
			statusMessage: 'Bad Request',
			message: 'A Graphic Style Set Package must be sent as the request body',
		});
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

/**
 * An accepted export streams the archive; a rejected one returns the one complete
 * report with stable codes as a `409`, because every reason a Style Set cannot be
 * packaged is something its author has to correct rather than retry.
 */
export function respondWithGraphicStyleSetPackage(
	event: H3Event,
	outcome: GraphicStyleSetPackageExportOutcome,
): ReadableStream<Uint8Array> {
	if (outcome.outcome === 'rejected') {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'The Graphic Style Set Package could not be exported',
			data: outcome.report,
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
 * This installation's Graphic Style Set library, as the ports the package module is
 * written against.
 *
 * The module never reaches the database itself, so the whole conflict table, the
 * fingerprint, and every disposition can be proved without one — and the two routes
 * that use it cannot come to read the same library differently.
 */
export function graphicStyleSetPackagePorts(): GraphicStyleSetPackageInstallPorts {
	const service = graphicStyleSetService();

	const findInstalled = async (
		styleSetId: string,
	): Promise<InstalledGraphicStyleSetFacts | undefined> => {
		const styleSet = await service.findById(styleSetId);
		if (!styleSet)
			return undefined;
		return {
			id: styleSet.id,
			name: styleSet.name,
			revision: styleSet.revision,
			draftRevision: styleSet.draftRevision,
			published: styleSet.published,
			// Derived rather than stored, and structurally rather than by equality: the
			// draft is held in memory and the published entries came back out of storage,
			// so their keys are not in the same order.
			hasUnpublishedChanges: !sameGraphicStyleValue(styleSet.draft, styleSet.published),
		};
	};

	return {
		findInstalled,
		findInstalledRow: styleSetId => service.findById(styleSetId),
		findLinkedTemplates: async (styleSetId, entries) => {
			const linked = await service.linkedTemplates(styleSetId);
			return affectedTemplates(linked, resolveGraphicStyleSet(entries));
		},
		createPublished: input => service.createPublished(input),
		republish: input => service.republishFromPackage(input),
		newIdentity: randomUuid,
	};
}
