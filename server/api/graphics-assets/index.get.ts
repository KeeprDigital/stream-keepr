import { graphicsAssetLibraryForEvent } from '~~/server/modules/graphics-asset-library/runtime';
import { requireGraphicsAuthorSession } from '~~/server/modules/graphics-author-session';

/**
 * Discovery across the whole Graphics Asset Library.
 *
 * The listing is installation-wide by design — `CONTEXT.md` has graphics
 * authors discovering and referencing every Graphic Asset — so the session is
 * asked for as authentication and never consulted again. #172 closed the
 * asymmetry #90 left: writing to the library required a session while reading
 * all of it required nothing.
 */
export default defineEventHandler(async (event) => {
	await requireGraphicsAuthorSession(event);
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
