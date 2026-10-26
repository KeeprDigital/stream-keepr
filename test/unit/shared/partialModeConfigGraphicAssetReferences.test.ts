import type { GraphicAssetReferencingScreenMode, GraphicAssetReferencingScreenModeConfigs } from '~~/shared/utils/graphicsAssetReferences';
import { describe, expect, it } from 'vitest';
import { screenModeGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/*
 * A stored mode configuration is legitimately partial: a mode-configuration
 * PATCH writes a fragment, and readers complete it from the mode's defaults.
 * Discovery runs against exactly those stored fragments on the write path, so a
 * fragment missing the key that pins assets has to publish what its rendering
 * would — nothing — rather than throwing a 500 out of the save (#625).
 */
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
		[
			'background',
			{ background: {} },
		],
	])('publishes nothing for a %s fragment with no assets in it', (mode, modeConfigs) => {
		expect(screenModeGraphicAssetReferences(mode, modeConfigs)).toEqual([]);
	});
});
