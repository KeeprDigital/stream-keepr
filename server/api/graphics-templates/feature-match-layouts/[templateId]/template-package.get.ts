import { findFeatureMatchLayoutTemplateLibraryEntry } from '~~/server/modules/feature-match-layout-template-library';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { featureMatchLayoutTemplateParamsSchema } from '~~/server/schemas/api/featureMatchLayoutTemplate';
import { exportFeatureMatchLayoutTemplatePackage } from '~~/server/utils/templatePackageExportApi';

/**
 * Export one Feature Match Layout Template as a `.sklayout` Template Package.
 *
 * This is the portable form of the library artifact itself, which is why it hangs
 * off the template rather than off any Screen: the library is installation-scoped,
 * so a layout travels from wherever it was saved without an Event or a Screen having
 * to still exist.
 *
 * The package carries the template's stable identity and its current revision as
 * provenance — the pair a receiving installation recognises a later package of the
 * same design by. It is provenance only; nothing here creates a link an import could
 * follow back.
 *
 * The envelope, its limits, and its integrity facts all come from the one Graphics
 * Asset Library export contract the `.skgraphic` workflow uses. What differs is only
 * the artifact and what it requires.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { templateId } = await getValidatedRouterParams(
		event,
		featureMatchLayoutTemplateParamsSchema.parse,
	);

	// An imported layout exports as readily as an authored one. Nothing about a
	// package depends on where its Template came from, and refusing would strand a
	// design on the first installation that received it.
	const template = await findFeatureMatchLayoutTemplateLibraryEntry(event, templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Feature Match Layout Template not found',
		});
	}

	return await exportFeatureMatchLayoutTemplatePackage(event, {
		identity: template.id,
		name: template.name,
		revision: template.revision,
		document: template.document,
	});
});
