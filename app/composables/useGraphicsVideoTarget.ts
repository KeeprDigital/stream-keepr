import { graphicsVideoTargetForUserAgent } from '~~/shared/utils/graphicAssetTargetCompatibility';

export function useGraphicsVideoTarget() {
	return computed(() =>
		import.meta.client
			? graphicsVideoTargetForUserAgent(navigator.userAgent)
			: 'other');
}
