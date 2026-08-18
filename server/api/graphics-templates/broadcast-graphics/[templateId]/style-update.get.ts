import { broadcastGraphicTemplateParamsSchema } from '~~/server/schemas/api/broadcastGraphicTemplate';
import { broadcastGraphicTemplateService } from '~~/server/services/broadcastGraphicTemplate';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { requireUserId } from '~~/server/utils/auth';
import { graphicStyleUpdateReview } from '~~/shared/modules/graphic-style-sets';

/**
 * What a Graphic Style Set update would change in one Broadcast Graphic Template.
 *
 * This is the review an author reads before deciding anything, and it is why a
 * published Style Set is never a silent mutation: the change exists here as a list of
 * property groups with their current and proposed values, and does not exist in the
 * template until the author posts back.
 *
 * `available` is false when the published entries resolve to exactly what the
 * template already renders. That is the whole test — not "is there a newer revision"
 * — which is what makes renaming an entry, adding one, and editing one this template
 * never references all produce nothing to review.
 *
 * The session is session-scoping, not access control (ADR-0008, #206).
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { templateId } = await getValidatedRouterParams(event, broadcastGraphicTemplateParamsSchema.parse);

	const template = await broadcastGraphicTemplateService().findById(templateId);
	if (!template) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Broadcast Graphic Template not found',
		});
	}

	const link = template.document.styleSet;
	const styleSet = link ? await graphicStyleSetService().findById(link.styleSetId) : undefined;

	return graphicStyleUpdateReview(
		template.document,
		styleSet
			? {
					id: styleSet.id,
					name: styleSet.name,
					publishedRevision: styleSet.revision,
					published: styleSet.published,
				}
			: null,
	);
});
