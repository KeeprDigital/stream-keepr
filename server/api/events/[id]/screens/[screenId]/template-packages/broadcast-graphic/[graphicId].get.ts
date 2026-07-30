import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { rethrowGraphicsAssetApiError } from '~~/server/utils/graphicsAssetApi';
import { respondWithTemplatePackage } from '~~/server/utils/templatePackageExportApi';
import { broadcastGraphicTemplatePackageRequirements } from '~~/shared/utils/templatePackageRequirements';

/**
 * Exports one Broadcast Graphic Template as a `.skgraphic` Template Package.
 *
 * A package carries exactly one Broadcast Graphic, never the Screen's whole
 * authored stack, and never any other Screen configuration. Its asset collection
 * and envelope come from the same Graphics Asset Library export contract the
 * `.sklayout` workflow uses.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const graphicId = getRouterParam(event, 'graphicId') ?? '';

	const screen = await screenService().findById(screenId, eventId);
	if (!screen) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Screen not found',
		});
	}
	const graphic = screen.modeConfigs?.['broadcast-graphics']?.graphics
		?.find(candidate => candidate.id === graphicId);
	if (!graphic) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic not found on this Screen',
		});
	}

	const requirements = broadcastGraphicTemplatePackageRequirements(graphic);
	try {
		return respondWithTemplatePackage(
			event,
			await graphicsAssetLibraryForEvent(event).exportTemplatePackage({
				packageKind: 'skgraphic',
				template: {
					identity: graphic.id,
					name: graphic.name,
					document: graphic,
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
