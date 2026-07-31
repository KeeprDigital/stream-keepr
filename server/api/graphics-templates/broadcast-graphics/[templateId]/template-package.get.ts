import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { respondWithTemplatePackage } from '~~/server/utils/templatePackageExportApi';
import { broadcastGraphicTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';

/**
 * Export one Broadcast Graphic Template as a `.skgraphic` Template Package.
 *
 * This is the portable form of the library artifact itself, which is why it hangs
 * off the template rather than off any Screen: the library is installation-scoped,
 * so a design travels from wherever it was saved without an Event or a Screen having
 * to still exist, or having to be the one it was authored on.
 *
 * The package carries the template's stable identity and its current revision as
 * provenance. That pair is what a receiving installation recognises a later package
 * of the same design by — and it is provenance only. Nothing here creates a link an
 * import could follow back, and an installation that imports this package owes this
 * one nothing.
 *
 * Asset collection, the envelope, its limits, and its integrity facts all come from
 * the one Graphics Asset Library export contract the `.sklayout` workflow uses. The
 * only thing this route contributes is what a Broadcast Graphic Template requires,
 * discovered by the same walk the Screen's own reference index uses.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { templateId } = await getValidatedRouterParams(
		event,
		broadcastGraphicTemplateParamsSchema.parse,
	);

	const template = await broadcastGraphicTemplateService().findById(templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	const requirements = broadcastGraphicTemplatePackageRequirements(template.document);
	try {
		return respondWithTemplatePackage(
			event,
			await graphicsAssetLibraryForEvent(event).exportTemplatePackage({
				packageKind: 'skgraphic',
				template: {
					identity: template.id,
					name: template.name,
					revision: template.revision,
					document: template.document,
				},
				assets: requirements.assets,
				capabilities: requirements.capabilities,
			}),
		);
	}
	catch (error) {
		rethrowGraphicsAssetApiError(error, event);
	}
});
