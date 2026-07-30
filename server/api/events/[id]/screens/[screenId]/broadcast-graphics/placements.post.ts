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
	// Kept so a failure about a placed Graphic Item can be reported against the
	// template Graphic Item an author can actually go and look at.
	const idMap = new Map<string, string>();
	const graphic = placeBroadcastGraphicTemplate(
		{ id: template.id, name: template.name, document: template.document },
		{ generateId: randomUuid, existing, idMap },
	);

	try {
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
	}
	catch (error) {
		throw templateOrientedPlacementError(error, template, graphic.id, idMap);
	}
});

/**
 * Restate a Screen write failure in terms of the template that was placed.
 *
 * The Screen's write path refuses a Graphic Asset Reference that is not selectable
 * now, and names the slot that carries it — which for a placement is composed
 * entirely of ids generated microseconds earlier, on a Broadcast Graphic that was
 * never written. An author reading `graphics.<uuid>.items.<uuid>.asset` has nothing
 * to look for, so the ids are translated back to the template's own and the template
 * is named. This is the branch's most consequential inherited behaviour: a template
 * whose asset has since been retired cannot be placed, and the operator has to be
 * able to tell *which design* is unplaceable and *which item* in it to repair.
 */
function templateOrientedPlacementError(
	error: unknown,
	template: { id: string; name: string; document: { id: string } },
	placedGraphicId: string,
	idMap: Map<string, string>,
): unknown {
	const failure = error as { statusCode?: number; message?: string };
	if (failure?.statusCode !== 409 || typeof failure.message !== 'string')
		return error;
	if (!failure.message.startsWith('Graphic Asset Reference at '))
		return error;

	const toTemplateId = new Map([
		[placedGraphicId, template.document.id],
		...[...idMap].map(([templateItemId, placedItemId]) => [placedItemId, templateItemId] as const),
	]);
	const slot = failure.message
		.slice('Graphic Asset Reference at '.length)
		.replace(/ is not selectable$/, '')
		.split('.')
		.map(segment => toTemplateId.get(segment) ?? segment)
		.join('.');

	return createError({
		statusCode: 409,
		statusMessage: 'Conflict',
		message: `Broadcast Graphic Template "${template.name}" cannot be placed: the Graphic Asset Revision at ${slot} is no longer selectable`,
	});
}
