const SCREEN_OUTPUT_ASSET_DELIVERY_PATH
	= /^\/api\/screen-output\/screens\/[^/]+\/assets\/[^/]+\/revisions\/[^/]+\/content(?:\?.*)?$/;

export function safeErrorLogPath(path: string | undefined): string | undefined {
	if (path && SCREEN_OUTPUT_ASSET_DELIVERY_PATH.test(path)) {
		return '/api/screen-output/screens/:screenId/assets/:assetId/revisions/:revisionId/content';
	}
	return path;
}
