import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { exportFeatureMatchLayoutTemplatePackage } from '~~/server/utils/templatePackageExportApi';

/**
 * Exports the Feature Match Layout a Screen currently carries as a `.sklayout`
 * Template Package.
 *
 * The layout travels without the Screen around it. A Feature Match Slot assignment
 * is Screen state and lives beside the layout rather than inside it, so what is
 * packaged here is exactly what the library stores when the same layout is saved as
 * a Feature Match Layout Template — the same document, through the same exporter.
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

	return await exportFeatureMatchLayoutTemplatePackage(event, {
		identity: `screen-${screenId}-feature-match-layout`,
		name: screen.name,
		document: stored.layout,
	});
});
