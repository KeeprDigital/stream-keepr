import { themeLibraryModule } from '~~/server/modules/theme-library';
import { themeParamsSchema } from '~~/server/schemas/api/theme';

/** Delete a Theme no Event uses; refused, naming the Events, while any does. */
export default defineEventHandler(async (event) => {
	const { themeId } = await getValidatedRouterParams(event, themeParamsSchema.parse);
	await themeLibraryModule().remove(themeId);
	setResponseStatus(event, 204);
});
