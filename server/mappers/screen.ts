import type { DbScreen } from '~~/server/db/schema';
import type { ScreenResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';

export function mapScreenToResponse(screen: DbScreen): ScreenResponse {
	const {
		assetCapabilityDigest: _assetCapabilityDigest,
		assetCapabilitySeed: _assetCapabilitySeed,
		assetCapabilityVersion: _assetCapabilityVersion,
		graphicAssetReferenceVersion: _graphicAssetReferenceVersion,
		...publicScreen
	} = screen;
	return mapTimestamps(publicScreen);
}
