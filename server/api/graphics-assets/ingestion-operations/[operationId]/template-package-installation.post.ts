import { graphicsIngestionOperationId } from '~~/server/modules/graphics-asset-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { adoptInstalledGraphicsTemplate } from '~~/server/modules/template-package-payload';
import {
	graphicsAuthorIdentity,
	rethrowGraphicsAssetApiError,
} from '~~/server/utils/graphicsAssetApi';

/**
 * Installs one confirmed Template Package, and puts the result in the library its
 * artifact belongs to.
 *
 * The route carries no proposal of its own: what installs is exactly the report
 * the author confirmed, and the library proves that report still describes this
 * package before publishing anything. Posting twice is the same act twice, so a
 * client that lost a response asks again rather than installing a second copy.
 *
 * ## Why adoption is a second step, and why that is still safe
 *
 * The Graphics Asset Library publishes assets, origins, rewritten references, and
 * one Installed Graphics Template in a single transaction, and it stops there: it
 * owns asset storage and lifecycle and deliberately owns no template library. So
 * the design an author browses and places is written afterwards, by the payload that
 * owns that library.
 *
 * That leaves a window in which the installation has committed and the library entry
 * has not — and the window is harmless, because nothing in it is *partial*. The
 * Installed Graphics Template is complete and its references already pin exactly the
 * revisions it needs, so a crash mid-window leaves valid state rather than a
 * half-installed Template. Adoption is idempotent on that Template's own identity,
 * so the retry this endpoint already invites converges: the library answers with the
 * installation that committed, and adoption finishes what it started.
 *
 * The atomicity that spec user story 44 asks for is a different guarantee and lives
 * further upstream. A package requiring an unsupported Graphic Item Definition or
 * configuration version is refused at Template Package Preflight, before an asset,
 * an origin, a reference, or a Template exists — never here.
 */
export default defineEventHandler(async (event) => {
	try {
		const library = graphicsAssetLibraryForEvent(event);
		const operation = await library.installTemplatePackage({
			operationId: graphicsIngestionOperationId(getRouterParam(event, 'operationId') ?? ''),
			initiatedBy: graphicsAuthorIdentity(event),
		});

		const installation = operation.templatePackageInstallation;
		const preflight = operation.templatePackagePreflight;
		if (installation && preflight) {
			await adoptInstalledGraphicsTemplate(preflight.packageKind, {
				installed: await library.inspectInstalledGraphicsTemplate({
					templateId: installation.templateId,
				}),
				sourceTemplateRevision: preflight.templateRevision,
			});
		}

		return operation;
	}
	catch (error) {
		return rethrowGraphicsAssetApiError(error, event);
	}
});
