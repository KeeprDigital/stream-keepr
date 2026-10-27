import { themeLibraryModule } from '~~/server/modules/theme-library';
import { themeParamsSchema } from '~~/server/schemas/api/theme';

export default defineEventHandler(async (event) => {
	const { themeId } = await getValidatedRouterParams(event, themeParamsSchema.parse);
	return await themeLibraryModule().get(themeId);
});
