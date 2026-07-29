import type { DbScreen } from '~~/server/db/schema';
import type { ScreenResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import { normalizeFeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';

export function mapScreenToResponse(screen: DbScreen): ScreenResponse {
	const {
		assetCapabilityDigest: _assetCapabilityDigest,
		assetCapabilitySeed: _assetCapabilitySeed,
		assetCapabilityVersion: _assetCapabilityVersion,
		graphicAssetReferenceVersion: _graphicAssetReferenceVersion,
		...publicScreen
	} = screen;
	const overlayConfig = publicScreen.modeConfigs?.['feature-match-overlay'];
	return mapTimestamps({
		...publicScreen,
		modeConfigs: overlayConfig
			? {
					...publicScreen.modeConfigs,
					'feature-match-overlay': normalizeFeatureMatchOverlayModeConfig(overlayConfig),
				}
			: publicScreen.modeConfigs,
	});
}
