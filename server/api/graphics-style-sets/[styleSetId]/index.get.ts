import { mapGraphicStyleSetToResponse } from '~~/server/mappers/graphicStyleSet';
import { graphicStyleSetParamsSchema } from '~~/server/schemas/api/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';

/** One Graphic Style Set with both its working draft and its published entries. */
export default defineEventHandler(async (event) => {
	const { styleSetId } = await getValidatedRouterParams(event, graphicStyleSetParamsSchema.parse);

	const styleSet = await graphicStyleSetService().findById(styleSetId);
	if (!styleSet) {
		throw createError({
			statusCode: 404,
			statusMessage: 'Not Found',
			message: 'Graphic Style Set not found',
		});
	}

	return mapGraphicStyleSetToResponse(styleSet);
});
