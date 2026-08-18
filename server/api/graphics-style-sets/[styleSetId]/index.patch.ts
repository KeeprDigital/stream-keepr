import { mapGraphicStyleSetToResponse } from '~~/server/mappers/graphicStyleSet';
import {
	GRAPHIC_STYLE_SET_DRAFT_BODY_BYTES,
	graphicStyleSetParamsSchema,
	updateGraphicStyleSetSchema,
} from '~~/server/schemas/api/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { requireUserId } from '~~/server/utils/auth';
import { rethrowAsGraphicStyleSetConflict } from '~~/server/utils/graphicStyleSetConflict';
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
	await requireUserId(event);
	const { styleSetId } = await getValidatedRouterParams(event, graphicStyleSetParamsSchema.parse);
	const body = updateGraphicStyleSetSchema.parse(
		await readJsonPayloadLimited(event, GRAPHIC_STYLE_SET_DRAFT_BODY_BYTES, 'Graphic Style Set'),
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
		rethrowAsGraphicStyleSetConflict(error, 'This Graphic Style Set has been edited by another session');
	}
});
