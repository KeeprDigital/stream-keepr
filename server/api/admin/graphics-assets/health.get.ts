import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';

// This route belongs to the application's current trusted administrator
// surface. Add installation-admin authorization here when auth is introduced.
export default defineEventHandler(async (event) => {
	return await graphicsAssetLibraryForEvent(event).getHealth();
});
