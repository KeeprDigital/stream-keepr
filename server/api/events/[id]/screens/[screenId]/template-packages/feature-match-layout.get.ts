import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { respondWithTemplatePackage } from '~~/server/utils/templatePackageExportApi';
import { normalizeFeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import { featureMatchLayoutTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';

/**
 * Exports one Feature Match Layout Template as a `.sklayout` Template Package.
 *
 * This workflow owns its payload — the Screen's reusable layout, migrated the
 * same way every other read boundary migrates it — and its own asset discovery.
 * Collecting and embedding the exact revisions is the Graphics Asset Library's
 * one export contract, shared with the `.skgraphic` workflow.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);

	const screen = await screenService().findById(screenId, eventId);
	if (!screen) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Screen not found',
		});
	}
	const stored = screen.modeConfigs?.['feature-match-overlay'];
	if (!stored) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'This Screen has no Feature Match Layout to export',
		});
	}

	const config = normalizeFeatureMatchOverlayModeConfig(stored);
	const requirements = featureMatchLayoutTemplatePackageRequirements(config);
	try {
		return respondWithTemplatePackage(
			event,
			await graphicsAssetLibraryForEvent(event).exportTemplatePackage({
				packageKind: 'sklayout',
				template: {
					identity: `screen-${screenId}-feature-match-layout`,
					name: screen.name,
					// A Template carries the reusable layout, never the Screen's
					// current Feature Match assignment or live state.
					document: config.layout,
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
