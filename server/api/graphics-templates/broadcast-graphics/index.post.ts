import { mapBroadcastGraphicTemplateToResponse } from '~~/server/mappers/broadcastGraphicTemplate';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { saveBroadcastGraphicTemplateSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';
import { screenService } from '~~/server/services/screen';
import { assertBroadcastGraphicTemplateReferencesExist } from '~~/server/utils/broadcastGraphicTemplateReferences';
import { broadcastGraphicTemplateDocument } from '~~/shared/modules/graphics';
import { randomUuid } from '~~/shared/utils/uuid';

/**
 * Save one placed Broadcast Graphic as a reusable Broadcast Graphic Template.
 *
 * The template starts at revision 1 under a fresh stable identity, and the Screen
 * it was saved from is left exactly as it was: saving is a copy out of live Screen
 * configuration into the library, never a conversion of the placed graphic into a
 * reference to a template.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const body = saveBroadcastGraphicTemplateSchema.parse(await readBody(event));

	const screen = await screenService().findById(body.source.screenId, body.source.eventId);
	if (!screen)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Screen not found' });

	const graphic = screen.modeConfigs?.['broadcast-graphics']?.graphics
		?.find(candidate => candidate.id === body.source.graphicId);
	if (!graphic) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic not found on this Screen',
		});
	}

	const document = broadcastGraphicTemplateDocument(graphic);
	await assertBroadcastGraphicTemplateReferencesExist(graphicsAssetLibraryForEvent(event), document);

	const template = await broadcastGraphicTemplateService().create({
		id: randomUuid(),
		name: body.name ?? graphic.name,
		description: body.description ?? null,
		document,
	});

	setResponseStatus(event, 201);
	return mapBroadcastGraphicTemplateToResponse(template);
});
