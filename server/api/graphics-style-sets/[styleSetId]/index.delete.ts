import { planGraphicStyleSetDeletion } from '~~/server/modules/graphic-style-set';
import {
	deleteGraphicStyleSetSchema,
	GRAPHIC_STYLE_SET_COMMAND_BODY_BYTES,
	graphicStyleSetParamsSchema,
} from '~~/server/schemas/api/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { requireUserId } from '~~/server/utils/auth';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

/**
 * Delete one Graphic Style Set, detaching every template linked to it.
 *
 * There is no replace mode: replacing one Style Set with another would mean matching
 * entries between two independently authored sets, which is a bulk-mapping workflow
 * the glossary rules out. Detaching is what remains, and it is safe — every linked
 * template already stores the values it renders, so each one gets a new revision that
 * has lost the provenance and nothing else. Nothing on any output changes.
 *
 * The whole thing is one operation: every template revision and the deletion succeed
 * together or none of them does, each rewrite conditional on the revision it was read
 * at. A template another author revised in the meantime refuses the deletion rather
 * than being skipped, because a Style Set deleted while one template still references
 * its entries would leave that template pointing at nothing.
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
	const { styleSetId } = await getValidatedRouterParams(event, graphicStyleSetParamsSchema.parse);
	const body = deleteGraphicStyleSetSchema.parse(
		await readJsonPayloadLimited(
			event,
			GRAPHIC_STYLE_SET_COMMAND_BODY_BYTES,
			'Graphic Style Set deletion request',
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
	const removed = await service.remove(styleSetId, {
		draftRevision: body.draftRevision,
		rewrites: planGraphicStyleSetDeletion(linked),
	});

	if (!removed) {
		throw createError({
			statusCode: 409,
			statusMessage: 'Conflict',
			message: 'The Graphic Style Set or one of the templates linked to it changed while it was being deleted',
		});
	}

	setResponseStatus(event, 204);
	return null;
});
