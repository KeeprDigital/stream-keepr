import type { GraphicAssetReferencingScreenMode, GraphicAssetReferencingScreenModeConfigs } from '~~/shared/utils/graphicsAssetReferences';
import { describe, expect, it } from 'vitest';
import { screenModeGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

// A stored mode configuration is a PATCH fragment, so discovery on the write path
// must publish nothing for a fragment missing its asset keys rather than throw (#625).
// Background and Background Layer modes cover their own fragments.
describe('screenModeGraphicAssetReferences on a partial stored configuration', () => {
	it.each<[GraphicAssetReferencingScreenMode, GraphicAssetReferencingScreenModeConfigs]>([
		[
			'feature-match-overlay',
			{
				'feature-match-overlay': { featureMatchId: 7 },
			},
		],
		[
			'broadcast-graphics',
			{
				'broadcast-graphics': { channels: [] },
			},
		],
	])('publishes nothing for a %s fragment with no assets in it', (mode, modeConfigs) => {
		expect(screenModeGraphicAssetReferences(mode, modeConfigs)).toEqual([]);
	});
});
