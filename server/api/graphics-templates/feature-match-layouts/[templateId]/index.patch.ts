import { mapFeatureMatchLayoutTemplateToResponse } from '~~/server/mappers/featureMatchLayoutTemplate';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import {
	featureMatchLayoutTemplateParamsSchema,
	updateFeatureMatchLayoutTemplateSchema,
} from '~~/server/schemas/api/featureMatchLayoutTemplate';
import {
	FeatureMatchLayoutTemplateReferenceConflict,
	FeatureMatchLayoutTemplateRevisionConflict,
	featureMatchLayoutTemplateService,
} from '~~/server/services/featureMatchLayoutTemplate';
import { requireUserId } from '~~/server/utils/auth';
import {
	assertFeatureMatchLayoutTemplateReferencesSelectable,
	refuseInstalledFeatureMatchLayoutTemplateWrite,
} from '~~/server/utils/featureMatchLayoutTemplateWrites';
import { graphicsTemplateReferenceConflict } from '~~/server/utils/graphicsTemplateReferences';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

/**
 * Revise one Feature Match Layout Template.
 *
 * Every accepted change — name, description, or layout — advances the automatically
 * managed revision by one under the same stable identity.
 *
 * Two independent guards, answering different questions. The compare-and-swap on
 * `revision` stops a second session with the library open overwriting a change it
 * never read. The Graphics Authoring Lease is coarser and answers whether this
 * session may write this template at all.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, featureMatchLayoutTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	const body = updateFeatureMatchLayoutTemplateSchema.parse(
		await readJsonPayloadLimited(event, 512 * 1024, 'Feature Match Layout Template'),
	);

	// Every revision re-states every reference the stored layout will hold, so a
	// rename is held to the rule as much as a new layout is (#614). A rename built on
	// a stale revision is left to the compare-and-swap, so the author hears about the
	// revision they missed first.
	const stored = body.document ? undefined : await featureMatchLayoutTemplateService().findById(templateId);
	const document = body.document ?? (stored?.revision === body.revision ? stored.document : undefined);
	if (document)
		await assertFeatureMatchLayoutTemplateReferencesSelectable(graphicsAssetLibraryForEvent(event), document);

	try {
		const template = await featureMatchLayoutTemplateService().update(templateId, body);
		if (!template) {
			await refuseInstalledFeatureMatchLayoutTemplateWrite(event, templateId, 'revised');
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Feature Match Layout Template not found',
			});
		}

		return mapFeatureMatchLayoutTemplateToResponse(template);
	}
	catch (error) {
		if (error instanceof FeatureMatchLayoutTemplateReferenceConflict)
			throw graphicsTemplateReferenceConflict('Feature Match Layout Template');
		// A stale revision is the author's problem to resolve, not an internal fault:
		// they are told which revision the template is actually at so they can re-read
		// it rather than retrying blindly.
		if (error instanceof FeatureMatchLayoutTemplateRevisionConflict) {
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: `Feature Match Layout Template has been revised by another session (now revision ${error.currentRevision})`,
			});
		}
		throw error;
	}
});
