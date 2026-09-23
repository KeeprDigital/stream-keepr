import { mapGraphicStyleSetToResponse } from '~~/server/mappers/graphicStyleSet';
import { graphicStyleSetParamsSchema } from '~~/server/schemas/api/graphicStyleSet';
import { graphicStyleSetService } from '~~/server/services/graphicStyleSet';
import { requireUserId } from '~~/server/utils/auth';

/**
 * One Graphic Style Set with both its working draft and its published entries.
 *
 * The session is session-scoping, not access control (ADR-0010, #206).
 */
export default defineEventHandler(async (event) => {
	await requireUserId(event);
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
