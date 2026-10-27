import { themeLibraryModule } from '~~/server/modules/theme-library';
import { renameThemeSchema, themeParamsSchema } from '~~/server/schemas/api/theme';

/** Rename a Theme. No Screen renders its name, so nothing is announced. */
export default defineEventHandler(async (event) => {
	const { themeId } = await getValidatedRouterParams(event, themeParamsSchema.parse);
	const { name } = await readValidatedBody(event, renameThemeSchema.parse);
	return await themeLibraryModule().rename(themeId, name);
});
