import { themeLibraryModule } from '~~/server/modules/theme-library';
import { createThemeSchema } from '~~/server/schemas/api/theme';

/** Create a Theme. It sets no token, so it reads identically to the Default Theme. */
export default defineEventHandler(async (event) => {
	const { name } = await readValidatedBody(event, createThemeSchema.parse);
	const theme = await themeLibraryModule().create(name);
	setResponseStatus(event, 201);
	return theme;
});
