import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { requireUserId } from '~~/server/utils/auth';
import { exportBroadcastGraphicTemplatePackage } from '~~/server/utils/templatePackageExportApi';

/**
 * Exports one Broadcast Graphic Template as a `.skgraphic` Template Package.
 *
 * A package carries exactly one Broadcast Graphic, never the Screen's whole
 * authored stack, and never any other Screen configuration. Its asset collection
 * and envelope come from the same Graphics Asset Library export contract the
 * `.sklayout` workflow uses.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
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

	// No revision to declare: a placed Broadcast Graphic is Screen configuration
	// rather than a library entry, so it has no managed revision to be provenance.
	return await exportBroadcastGraphicTemplatePackage(event, {
		identity: graphic.id,
		name: graphic.name,
		document: graphic,
	});
});
