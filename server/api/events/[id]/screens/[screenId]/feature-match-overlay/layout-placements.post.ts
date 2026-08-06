import { findFeatureMatchLayoutTemplateLibraryEntry } from '~~/server/modules/feature-match-layout-template-library';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireScreenGraphicsEditWritable } from '~~/server/modules/graphics-authoring-lease/screenEditWorkspace';
import { screenWriteModule } from '~~/server/modules/screen-write';
import { placeFeatureMatchLayoutTemplateSchema } from '~~/server/schemas/api/featureMatchLayoutTemplate';
import { screenParamsSchema } from '~~/server/schemas/api/screen';
import { screenService } from '~~/server/services/screen';
import { getOriginConnectionId } from '~~/server/utils/ably';

/**
 * Place a Feature Match Layout Template on this Screen as a fully unlinked copy.
 *
 * ## Why placing replaces rather than adds
 *
 * A Feature Match Overlay renders exactly one Feature Match Layout, so there is no
 * stack to append to and no ordering decision to make. Placing a layout template
 * replaces the Frame, the Source Items, and the composition together — all three or
 * none, because a Frame from one design under Source Items from another is not a
 * layout anybody authored. What survives is everything that was never part of the
 * layout: the Screen's Feature Match Slot assignment, its canvas size, and its live
 * session all belong to the Screen and are untouched.
 *
 * `presetId` is left alone too. It records which built-in starting point initialised
 * this Screen's layout, and a template is not one — overwriting it would claim the
 * layout came from a preset it has nothing to do with.
 *
 * ## Why it happens here rather than in the client
 *
 * The copy has to be *the* copy. The server reads the template and writes it through
 * the Screen's ordinary mode-configuration write path, so the placed layout is
 * validated by the same schema, capped the same way, indexed into the same Graphic
 * Asset Reference index, and published by the same notification as a hand-authored
 * one. A placement is an authoring action that produces nothing special, which is
 * what "unlinked copy" has to mean.
 *
 * The write is admitted by the Screen's graphics Edit workspace lease, not the
 * template's: placing reads a template and writes a Screen.
 */
export default defineEventHandler(async (event) => {
	const { id: eventId, screenId } = await getValidatedRouterParams(event, screenParamsSchema.parse);
	const body = placeFeatureMatchLayoutTemplateSchema.parse(await readBody(event) ?? {});

	await requireScreenGraphicsEditWritable(event, eventId, screenId);

	const screen = await screenService().findById(screenId, eventId);
	if (!screen)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Screen not found' });

	// A Feature Match Layout Template initialises the layout a Feature Match Overlay
	// renders. Placing one anywhere else would author a layout the Screen does not
	// render and no output would ever show.
	if (screen.currentMode !== 'feature-match-overlay') {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'Screen is not in Feature Match Overlay mode',
		});
	}

	// Resolved from the library as a whole. A layout a Template Package installed is
	// placed by exactly this path — its document already names local Graphic Asset
	// identities and revisions, so there is nothing about it for placement to treat
	// differently.
	const template = await findFeatureMatchLayoutTemplateLibraryEntry(event, body.templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Feature Match Layout Template not found',
		});
	}

	// Deep-copied so nothing the Screen later carries can alias the library entry
	// this request happened to read.
	const layout = structuredClone(template.document);

	try {
		const updated = await screenWriteModule().updateModeConfig({
			eventId,
			screenId,
			mode: 'feature-match-overlay',
			config: { layout },
			graphicsAssets: () => graphicsAssetLibraryForEvent(event),
			stateVersion: body.stateVersion,
			originConnectionId: getOriginConnectionId(event),
		});

		setResponseStatus(event, 201);
		return { screen: updated, layout };
	}
	catch (error) {
		throw templateOrientedPlacementError(error, template.name);
	}
});

/**
 * Restate a Screen write failure in terms of the template that was placed.
 *
 * The Screen's write path refuses a Graphic Asset Reference that is not selectable
 * now, and names the slot carrying it. A layout's slots are the template's own —
 * nothing is regenerated when a layout is placed, because a layout has one Frame,
 * one Source Item list, and one composition whose ids are the design's — so the slot
 * already points at something the author can find. What it does not say is *which
 * design* is unplaceable, and with a library of layouts that is the first thing they
 * need.
 */
function templateOrientedPlacementError(
	error: unknown,
	templateName: string,
): unknown {
	const failure = error as { statusCode?: number; message?: string };
	if (failure?.statusCode !== 409 || typeof failure.message !== 'string')
		return error;
	if (!failure.message.startsWith('Graphic Asset Reference at '))
		return error;

	const slot = failure.message
		.slice('Graphic Asset Reference at '.length)
		.replace(/ is not selectable$/, '');

	return createError({
		statusCode: 409,
		statusMessage: 'Conflict',
		message: `Feature Match Layout Template "${templateName}" cannot be placed: the Graphic Asset Revision at ${slot} is no longer selectable`,
	});
}
