import { themeLibraryModule } from '~~/server/modules/theme-library';

/** The installation's Theme library. The Default Theme is code, and is not listed. */
export default defineEventHandler(async () => {
	return await themeLibraryModule().list();
});
