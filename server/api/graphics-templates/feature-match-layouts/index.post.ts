import { mapFeatureMatchLayoutTemplateToResponse } from '~~/server/mappers/featureMatchLayoutTemplate';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { saveFeatureMatchLayoutTemplateSchema } from '~~/server/schemas/api/featureMatchLayoutTemplate';
import {
	FeatureMatchLayoutTemplateReferenceConflict,
	featureMatchLayoutTemplateService,
} from '~~/server/services/featureMatchLayoutTemplate';
import { screenService } from '~~/server/services/screen';
import { requireUserId } from '~~/server/utils/auth';
import { assertFeatureMatchLayoutTemplateReferencesSelectable } from '~~/server/utils/featureMatchLayoutTemplateWrites';
import { graphicsTemplateReferenceConflict } from '~~/server/utils/graphicsTemplateReferences';
import { randomUuid } from '~~/shared/utils/uuid';

/**
 * Save a Screen's Feature Match Layout as a reusable Feature Match Layout Template.
 *
 * The template starts at revision 1 under a fresh stable identity, and the Screen is
 * left exactly as it was: saving copies out of live Screen configuration into the
 * library, never converts the Screen's layout into a reference to a template.
 *
 * This is where "Event identities stripped" happens in fact. The Screen's Feature
 * Match Slot assignment lives beside the layout on the mode configuration and is
 * simply not read — there is no stripping step to forget, because the layout never
 * contained it. What the template carries instead are role-only Source declarations
 * and Feature Match token bindings, both of which resolve against whatever Slot the
 * Screen that later places it happens to hold.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const body = saveFeatureMatchLayoutTemplateSchema.parse(await readBody(event));

	const screen = await screenService().findById(body.source.screenId, body.source.eventId);
	if (!screen)
		throw createError({ statusCode: 404, statusMessage: 'Not Found', message: 'Screen not found' });

	const stored = screen.modeConfigs?.['feature-match-overlay'];
	if (!stored?.layout) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'This Screen has no Feature Match Layout to save',
		});
	}

	const document = structuredClone(stored.layout);
	await assertFeatureMatchLayoutTemplateReferencesSelectable(graphicsAssetLibraryForEvent(event), document);

	const template = await featureMatchLayoutTemplateService().create({
		id: randomUuid(),
		name: body.name ?? screen.name,
		description: body.description ?? null,
		document,
	}).catch((error: unknown) => {
		if (error instanceof FeatureMatchLayoutTemplateReferenceConflict)
			throw graphicsTemplateReferenceConflict('Feature Match Layout Template');
		throw error;
	});

	setResponseStatus(event, 201);
	return mapFeatureMatchLayoutTemplateToResponse(template);
});
