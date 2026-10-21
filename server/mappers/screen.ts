import type { DbScreen } from '~~/server/db/schema';
import type { ScreenResponse } from '~~/shared/api';
import { mapTimestamps } from '~~/server/utils/mapTimestamps';
import { clampStoredModeConfigs } from '~~/shared/types/screenConfig';

/**
 * A Screen as every client receives it. Its mode configurations are read within
 * their contracts' bounds (`clampStoredModeConfigs`, #498), so an editor never
 * offers, nor writes back, a stored value its contract no longer accepts.
 *
 * It carries no Screen Card. Only the Card read does, and that projects an
 * expired Card to `null`, so no Screen read shows the stored Card past its Card
 * Timeout (ADR-0022).
 */
export function mapScreenToResponse(screen: DbScreen): ScreenResponse {
	const {
		activeCard: _activeCard,
		activeCardVersion: _activeCardVersion,
		assetCapabilityDigest: _assetCapabilityDigest,
		assetCapabilitySeed: _assetCapabilitySeed,
		assetCapabilityVersion: _assetCapabilityVersion,
		graphicAssetReferenceVersion: _graphicAssetReferenceVersion,
		...publicScreen
	} = screen;
	return mapTimestamps({ ...publicScreen, modeConfigs: clampStoredModeConfigs(publicScreen.modeConfigs) });
}
