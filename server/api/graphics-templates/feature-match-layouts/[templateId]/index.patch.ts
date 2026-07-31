import { mapFeatureMatchLayoutTemplateToResponse } from '~~/server/mappers/featureMatchLayoutTemplate';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import {
	featureMatchLayoutTemplateParamsSchema,
	updateFeatureMatchLayoutTemplateSchema,
} from '~~/server/schemas/api/featureMatchLayoutTemplate';
import {
	FeatureMatchLayoutTemplateRevisionConflict,
	featureMatchLayoutTemplateService,
} from '~~/server/services/featureMatchLayoutTemplate';
import {
	assertFeatureMatchLayoutTemplateReferencesExist,
	refuseInstalledFeatureMatchLayoutTemplateWrite,
} from '~~/server/utils/featureMatchLayoutTemplateWrites';
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
	await requireGraphicsAuthorSession(event);
	const { templateId } = await getValidatedRouterParams(event, featureMatchLayoutTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	const body = updateFeatureMatchLayoutTemplateSchema.parse(
		await readJsonPayloadLimited(event, 512 * 1024, 'Feature Match Layout Template'),
	);

	if (body.document)
		await assertFeatureMatchLayoutTemplateReferencesExist(graphicsAssetLibraryForEvent(event), body.document);

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
