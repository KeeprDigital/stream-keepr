const SCREEN_OUTPUT_ASSET_DELIVERY_PATH
	= /^\/api\/screen-output\/screens\/[^/]+\/assets\/[^/]+\/revisions\/[^/]+\/content(?:\?.*)?$/;

/**
 * The output page's address carries a Screen Output Link, which is a
 * credential. Whatever stands in that segment is dropped, link-shaped or not,
 * with everything after it; case-folded as the router may fold it.
 */
const SCREEN_OUTPUT_LINK_PAGE_PATH = /^\/o\/[^/?#]+/i;

export function safeErrorLogPath(path: string | undefined): string | undefined {
	if (path && SCREEN_OUTPUT_ASSET_DELIVERY_PATH.test(path)) {
		return '/api/screen-output/screens/:screenId/assets/:assetId/revisions/:revisionId/content';
	}
	if (path && SCREEN_OUTPUT_LINK_PAGE_PATH.test(path))
		return '/o/:link';
	return path;
}
