import { mapGraphicStyleSetToResponse } from '~~/server/mappers/graphicStyleSet';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';
import {
	graphicStyleSetParamsSchema,
	updateGraphicStyleSetSchema,
} from '~~/server/schemas/api/graphicStyleSet';
import {
	GraphicStyleSetRevisionConflict,
	graphicStyleSetService,
} from '~~/server/services/graphicStyleSet';
import { readJsonPayloadLimited } from '~~/server/utils/payloadLimits';

/**
 * Edit one Graphic Style Set's working draft.
 *
 * Nothing here reaches a linked template. Edits accumulate in the draft, which is
 * exactly what lets an author restructure a palette — leaving it referentially
 * broken for most of the afternoon — without one linked template seeing an available
 * update or one published entry moving.
 *
 * The draft revision is required and compare-and-swapped for the same reason a
 * template's is: two authors with the library open must not silently overwrite each
 * other, and an omissible precondition is an inert one.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
	const { styleSetId } = await getValidatedRouterParams(event, graphicStyleSetParamsSchema.parse);
	const body = updateGraphicStyleSetSchema.parse(
		await readJsonPayloadLimited(event, 512 * 1024, 'Graphic Style Set'),
	);

	try {
		const styleSet = await graphicStyleSetService().update(styleSetId, body);
		if (!styleSet) {
			throw createError({
				statusCode: 404,
				statusMessage: 'Not Found',
				message: 'Graphic Style Set not found',
			});
		}

		return mapGraphicStyleSetToResponse(styleSet);
	}
	catch (error) {
		if (error instanceof GraphicStyleSetRevisionConflict) {
			throw createError({
				statusCode: 409,
				statusMessage: 'Conflict',
				message: `Graphic Style Set has been edited by another session (now draft revision ${error.currentDraftRevision})`,
			});
		}
		throw error;
	}
});
