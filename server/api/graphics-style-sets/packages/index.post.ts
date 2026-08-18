import { mapGraphicStyleSetToResponse } from '~~/server/mappers/graphicStyleSet';
import { installGraphicStyleSetPackage } from '~~/server/modules/graphic-style-set-package';
import { graphicStyleSetPackageInstallQuerySchema } from '~~/server/schemas/api/graphicStyleSetPackage';
import { requireUserId } from '~~/server/utils/auth';
import {
	graphicStyleSetPackagePorts,
	readGraphicStyleSetPackageBody,
} from '~~/server/utils/graphicStyleSetPackageApi';

/**
 * Install a received `.skstyle` package.
 *
 * One request, one write, or nothing at all. The package's own preflight is re-derived
 * from the exact bytes sent, so an installation is never performed against a report
 * that described a different package or a different library — and where the proposal
 * carried anything to weigh, it proceeds only under the fingerprint its author
 * confirmed.
 *
 * The four things it may do are the four the glossary allows, and no fifth:
 *
 * - Create the Style Set under the packaged identity and revision.
 * - Publish a newer packaged revision over an installed one, leaving every linked
 *   template an available style update to review rather than a rewritten document.
 * - Create an independent copy under a new identity, when its author asked for one.
 * - Nothing, when the exact identity, revision, and content are already installed.
 *
 * There is deliberately no field merge. A package is taken whole or not at all, and a
 * proposal that would have to choose between two authors' entries is refused with the
 * copy offered instead.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const query = await getValidatedQuery(event, graphicStyleSetPackageInstallQuerySchema.parse);
	const archive = await readGraphicStyleSetPackageBody(event);

	const outcome = await installGraphicStyleSetPackage({
		archive,
		resolution: query.resolution,
		sourceFileName: query.sourceFileName,
		confirmedFingerprint: query.fingerprint,
		ports: graphicStyleSetPackagePorts(),
		now: () => new Date(),
	});

	switch (outcome.outcome) {
		case 'rejected':
			throw createError({
				statusCode: 422,
				statusMessage: 'Unprocessable Entity',
				message: 'This Graphic Style Set Package cannot be installed',
				data: { report: outcome.report },
			});

		case 'requires-confirmation':
			// Not an error the package can be corrected for — the author has simply not
			// agreed to this proposal yet, so the report they must agree to is the answer.
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: 'This Graphic Style Set Package needs its proposed result confirmed',
				data: { report: outcome.report },
			});

		case 'conflict':
			// Published, edited, or deleted since the package was inspected — or, for a
			// first import, its identity claimed in the meantime. Nothing was written; the
			// author reruns preflight and sees the library as it now stands.
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: 'This Graphic Style Set has changed since its package was inspected',
				data: { report: outcome.report },
			});

		case 'already-installed':
			return {
				report: outcome.report,
				styleSet: mapGraphicStyleSetToResponse(outcome.styleSet),
				affectedTemplates: [],
			};

		case 'installed':
			setResponseStatus(event, outcome.report.disposition === 'update-installed' ? 200 : 201);
			return {
				report: outcome.report,
				styleSet: mapGraphicStyleSetToResponse(outcome.styleSet),
				affectedTemplates: outcome.affectedTemplates,
			};
	}
});
