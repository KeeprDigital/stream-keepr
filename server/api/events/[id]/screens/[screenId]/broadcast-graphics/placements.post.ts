import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireScreenGraphicsEditWritable } from '~~/server/modules/graphics-authoring-lease/screenEditWorkspace';
import { screenWriteModule } from '~~/server/modules/screen-write';
import { placeBroadcastGraphicTemplateSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';
import { screenService } from '~~/server/services/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';
import { placeBroadcastGraphicTemplate } from '~~/shared/modules/graphics';
import { randomUuid } from '~~/shared/utils/uuid';

/**
 * Place a Broadcast Graphic Template on this Screen as a fully unlinked copy.
 *
 * Placement happens here rather than in the client for two reasons that are really
 * one: the copy has to be *the* copy. The server reads the template, builds the
 * Broadcast Graphic, and writes it through the Screen's ordinary mode-configuration
 * write path — so the placed graphic is validated by the same schema, counted
 * against the same Screen-wide Graphic Item and Graphic Input caps, indexed into the
 * same Graphic Asset Reference index, and published by the same notification as a
 * hand-authored one. A placement is an authoring action that produces nothing
 * special, which is precisely what "unlinked copy" has to mean.
 *
 * The write is admitted by the Screen's graphics Edit workspace lease, not by the
 * template's: placing reads a template and writes a Screen, so two authors may
 * place the same template at the same instant.
 */
export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const body = placeBroadcastGraphicTemplateSchema.parse(await readBody(event) ?? {});

	await requireScreenGraphicsEditWritable(event, eventId, screenId);

	const screen = await screenService().findById(screenId, eventId);
	if (!screen)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Screen not found' });

	// A Broadcast Graphic Template initializes a copy of a Broadcast Graphic on a
	// Broadcast Graphics Screen. Placing one anywhere else would author a stack the
	// Screen does not compose and no output would ever show.
	if (screen.currentMode !== 'broadcast-graphics') {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'Screen is not in Broadcast Graphics mode',
		});
	}

	const template = await broadcastGraphicTemplateService().findById(body.templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	const existing = screen.modeConfigs?.['broadcast-graphics']?.graphics ?? [];
	const graphic = placeBroadcastGraphicTemplate(
		{ id: template.id, name: template.name, document: template.document },
		{ generateId: randomUuid, existing },
	);

	const updated = await screenWriteModule({
		graphicsAssets: graphicsAssetLibraryForEvent(event),
	}).updateModeConfig({
		eventId,
		screenId,
		mode: 'broadcast-graphics',
		// The copy joins the front of the Graphic Layer Order, where a newly authored
		// Broadcast Graphic also lands.
		config: { graphics: [...existing, graphic] },
		stateVersion: body.stateVersion,
		originConnectionId: getOriginConnectionId(event),
	});

	setResponseStatus(event, 201);
	return { screen: updated, graphic };
});
