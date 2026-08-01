import { mapGraphicStyleSetToResponse } from '~~/server/mappers/graphicStyleSet';
import { planGraphicStyleSetPublish } from '~~/server/modules/graphic-style-set';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import {
	GRAPHIC_STYLE_SET_COMMAND_BODY_BYTES,
	graphicStyleSetParamsSchema,
	publishGraphicStyleSetSchema,
} from '~~/server/schemas/api/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { rethrowAsGraphicStyleSetConflict } from '~~/server/utils/graphicStyleSetConflict';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

/**
 * Publish one Graphic Style Set's working draft as a new revision.
 *
 * One atomic step that proves the draft whole and then makes it the thing every
 * linked template resolves against: every entry reference exists and is of the kind
 * it is used as, no cycle closes, every entry is in a schema version this build
 * reads, and every font named is one this installation has. Any fault refuses the
 * whole publish and reports *all* of them together, each against the entry it is
 * about — a draft is up to two hundred entries and an author fixes them in one
 * sitting, so one fault per round trip would be a queue rather than a review.
 *
 * The response names the templates this reaches and says which of them actually
 * move. It does not touch one of them. A published change becomes an *available*
 * update that each template's author reviews and applies as a new template revision,
 * and this route is the only place that distinction could quietly be lost.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { styleSetId } = await getValidatedRouterParams(event, graphicStyleSetParamsSchema.parse);
	const body = publishGraphicStyleSetSchema.parse(
		await readJsonPayloadLimited(
			event,
			GRAPHIC_STYLE_SET_COMMAND_BODY_BYTES,
			'Graphic Style Set publish request',
		),
	);

	const service = graphicStyleSetService();
	const styleSet = await service.findById(styleSetId);
	if (!styleSet) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Graphic Style Set not found',
		});
	}

	const linked = await service.linkedTemplates(styleSetId);
	const plan = planGraphicStyleSetPublish(styleSet.draft, linked);
	if (plan.issues.length > 0) {
		throw createError({
			statusCode: 422,
			statusMessage: 'Unprocessable Entity',
			message: 'This Graphic Style Set draft cannot be published',
			data: { issues: plan.issues },
		});
	}

	try {
		const published = await service.publish(styleSetId, body.draftRevision);
		if (!published) {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Graphic Style Set not found',
			});
		}

		return {
			styleSet: mapGraphicStyleSetToResponse(published),
			affectedTemplates: plan.affected,
		};
	}
	catch (error) {
		// A publish that raced a draft edit would publish entries nobody validated.
		rethrowAsGraphicStyleSetConflict(error, 'This Graphic Style Set has been edited since its draft was validated');
	}
});
