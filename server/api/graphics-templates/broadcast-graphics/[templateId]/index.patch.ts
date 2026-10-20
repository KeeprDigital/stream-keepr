import { mapBroadcastGraphicTemplateToResponse } from '~~/server/mappers/broadcastGraphicTemplate';
import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import {
	broadcastGraphicTemplateParamsSchema,
	updateBroadcastGraphicTemplateSchema,
} from '~~/server/schemas/api/broadcastGraphicTemplate';
import {
	BroadcastGraphicTemplateReferenceConflict,
	BroadcastGraphicTemplateRevisionConflict,
	broadcastGraphicTemplateService,
} from '~~/server/services/broadcastGraphicTemplate';
import { requireUserId } from '~~/server/utils/auth';
import { assertBroadcastGraphicTemplateReferencesSelectable } from '~~/server/utils/broadcastGraphicTemplateReferences';
import { assertBroadcastGraphicTemplateStyleSetResolves } from '~~/server/utils/broadcastGraphicTemplateStyleSet';
import { refuseInstalledBroadcastGraphicTemplateWrite } from '~~/server/utils/broadcastGraphicTemplateWrites';
import { graphicsTemplateReferenceConflict } from '~~/server/utils/graphicsTemplateReferences';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

/**
 * Revise one Broadcast Graphic Template.
 *
 * Every accepted change — name, description, or composition — advances the
 * automatically managed revision by one under the same stable identity.
 *
 * Two independent guards, and they answer different questions. The compare-and-swap
 * on `revision` is what stops a second session with the library open overwriting a
 * change it never read: it refuses any writer whose stated revision is stale, whether
 * or not a lease exists anywhere. The Graphics Authoring Lease is coarser and answers
 * "may this session write this template at all" — while one session holds it, every
 * other session is refused even with a current revision. Nothing takes a template
 * lease yet, so today the compare-and-swap is the guard that actually fires.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);

	const body = updateBroadcastGraphicTemplateSchema.parse(
		await readJsonPayloadLimited(event, 512 * 1024, 'Broadcast Graphic Template'),
	);

	// Every revision re-states every reference the stored document will hold, so a
	// rename is held to the rule as much as a new composition is (#614). A rename
	// built on a stale revision is left to the compare-and-swap, so the author hears
	// about the revision they missed before anything in a document they never read.
	const stored = body.document ? undefined : await broadcastGraphicTemplateService().findById(templateId);
	const document = body.document ?? (stored?.revision === body.revision ? stored.document : undefined);
	if (document)
		await assertBroadcastGraphicTemplateReferencesSelectable(graphicsAssetLibraryForEvent(event), document);
	if (body.document)
		await assertBroadcastGraphicTemplateStyleSetResolves(body.document);

	try {
		const template = await broadcastGraphicTemplateService().update(templateId, body);
		if (!template) {
			await refuseInstalledBroadcastGraphicTemplateWrite(event, templateId, 'revised');
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Broadcast Graphic Template not found',
			});
		}

		return mapBroadcastGraphicTemplateToResponse(template);
	}
	catch (error) {
		if (error instanceof BroadcastGraphicTemplateReferenceConflict)
			throw graphicsTemplateReferenceConflict('Broadcast Graphic Template');
		// A stale revision is the author's problem to resolve, not an internal fault:
		// they are told which revision the template is actually at so they can re-read
		// it rather than retrying blindly.
		if (error instanceof BroadcastGraphicTemplateRevisionConflict) {
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: `Broadcast Graphic Template has been revised by another session (now revision ${error.currentRevision})`,
			});
		}
		throw error;
	}
});
