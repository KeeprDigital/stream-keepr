import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';

export default defineEventHandler(async (event) => {
	const searchValue = getQuery(event).search;
	const search = typeof searchValue === 'string' ? searchValue.slice(0, 200) : '';
	return await graphicsAssetLibraryForEvent(event).listGraphicAssets({ search });
});
