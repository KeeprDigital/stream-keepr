import { mapBroadcastGraphicTemplateToResponse } from '~~/server/mappers/broadcastGraphicTemplate';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import { requireGraphicsTemplateWritable } from '~~/server/modules/graphics-authoring-lease/graphicsTemplate';
import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { applyGraphicStyleUpdateSchema } from '~~/server/schemas/api/graphicStyleSet';
import {
	BroadcastGraphicTemplateRevisionConflict,
	broadcastGraphicTemplateService,
} from '~~/server/services/broadcastGraphicTemplate';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { applyGraphicStyleSet, resolveGraphicStyleSet } from '~~/shared/modules/graphic-style-sets';

/**
 * Apply a reviewed Graphic Style Set update to one Broadcast Graphic Template.
 *
 * Three properties, and each is load-bearing:
 *
 * - **Explicit.** Nothing here happens as a consequence of publishing. An author read
 *   the review and posted back, naming the template revision they were looking at.
 * - **Atomic, and one new revision.** The whole document is rebuilt and written once
 *   through the template's ordinary compare-and-swap write, so a template is never
 *   half-updated and the update is visible in the library as exactly one revision.
 * - **Overrides preserved.** Every local deviation is re-applied on top of the newly
 *   resolved preset, and a slot the author decided to keep is recorded as a fresh
 *   override so it does not move now or on any later republish.
 *
 * The whole template moves to the published revision together. There is no way to
 * accept some slots' new values and leave others inheriting an older revision,
 * because a template whose inherited references straddled two Style Set revisions
 * could never be reasoned about again.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);
	await requireGraphicsTemplateWritable(event, templateId);
	const body = applyGraphicStyleUpdateSchema.parse(await readBody(event));

	const service = broadcastGraphicTemplateService();
	const template = await service.findById(templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	const link = template.document.styleSet;
	if (!link) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'This Broadcast Graphic Template is not linked to a Graphic Style Set',
		});
	}

	const styleSet = await graphicStyleSetService().findById(link.styleSetId);
	if (!styleSet?.published) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'The Graphic Style Set this template links to has no published revision',
		});
	}

	const document = applyGraphicStyleSet(
		template.document,
		resolveGraphicStyleSet(styleSet.published),
		{ decisions: body.decisions, revision: styleSet.revision },
	);

	try {
		const updated = await service.update(templateId, { document, revision: body.revision });
		if (!updated) {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Broadcast Graphic Template not found',
			});
		}

		return mapBroadcastGraphicTemplateToResponse(updated);
	}
	catch (error) {
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
