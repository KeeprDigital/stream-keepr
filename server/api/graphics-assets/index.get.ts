import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';

export default defineEventHandler(async (event) => {
	const query = getQuery(event);
	const searchValue = query.search;
	const search = typeof searchValue === 'string' ? searchValue.slice(0, 200) : '';
	const lifecycleStates = typeof query.lifecycleStates === 'string'
		? query.lifecycleStates.split(',')
		: undefined;
	return await graphicsAssetLibraryForEvent(event).listGraphicAssets({
		search,
		lifecycleStates: lifecycleStates as ('active' | 'retired' | 'trashed')[] | undefined,
	});
});
