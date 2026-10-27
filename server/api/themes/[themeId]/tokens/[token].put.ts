import { themeLibraryModule } from '~~/server/modules/theme-library';
import { setThemeTokenSchema, themeTokenParamsSchema } from '~~/server/schemas/api/theme';
import { getOriginConnectionId } from '~~/server/utils/ably';

/** Set one Theme Token. Last write wins; there is no lease and no draft. */
export default defineEventHandler(async (event) => {
	const { themeId, token } = await getValidatedRouterParams(event, themeTokenParamsSchema.parse);
	const { value } = await readValidatedBody(event, setThemeTokenSchema.parse);
	return await themeLibraryModule().setToken({
		themeId,
		token,
		value,
		originConnectionId: getOriginConnectionId(event),
	});
});
