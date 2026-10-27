import { themeLibraryModule } from '~~/server/modules/theme-library';
import { themeTokenParamsSchema } from '~~/server/schemas/api/theme';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** Clear one Theme Token, so the Theme reads its default again. */
export default defineEventHandler(async (event) => {
	const { themeId, token } = await getValidatedRouterParams(event, themeTokenParamsSchema.parse);
	return await themeLibraryModule().clearToken({
		themeId,
		token,
		originConnectionId: getOriginConnectionId(event),
	});
});
