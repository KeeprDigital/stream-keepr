import type { DbScreen } from '~~/server/db/schema';
import type { ScreenResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import { clampStoredModeConfigs } from '~~/shared/types/screenConfig';

/**
 * A Screen as every client receives it. Its mode configurations are read within
 * their contracts' bounds (`clampStoredModeConfigs`, #498), so an editor never
 * offers, nor writes back, a stored value its contract no longer accepts.
 */
export function mapScreenToResponse(screen: DbScreen): ScreenResponse {
	const {
		assetCapabilityDigest: _assetCapabilityDigest,
		assetCapabilitySeed: _assetCapabilitySeed,
		assetCapabilityVersion: _assetCapabilityVersion,
		graphicAssetReferenceVersion: _graphicAssetReferenceVersion,
		...publicScreen
	} = screen;
	return mapTimestamps({ ...publicScreen, modeConfigs: clampStoredModeConfigs(publicScreen.modeConfigs) });
}
