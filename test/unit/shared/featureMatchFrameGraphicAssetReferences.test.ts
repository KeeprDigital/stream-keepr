import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import type { FeatureMatchLayoutConfig, ScreenMediaSource } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG, DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';
import { featureMatchLayoutGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

function asset(assetId: string, revisionId: string): ScreenMediaSource {
	return { kind: 'asset', assetId: assetId as GraphicAssetId, revisionId: revisionId as GraphicAssetRevisionId };
}

function layoutWithFrame(frame: Partial<FeatureMatchLayoutConfig['frame']>): FeatureMatchLayoutConfig {
	const layout = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout);
	layout.frame = { ...layout.frame, ...frame };
	layout.composition.items = [];
	return layout;
}

/**
 * The Frame's image and video each take a Screen Media Source (ADR-0021). Only
 * the library arm pins a revision; a Remote Media URL is a remote dependency and
 * fabricates no reference.
 */
describe('the Feature Match Overlay Frame’s own media references', () => {
	it('publishes a library-sourced Frame image and Frame video, each named by its slot', () => {
		const references = featureMatchLayoutGraphicAssetReferences(layoutWithFrame({
			backgroundImage: asset('plate', 'plate-1'),
			mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG, enabled: true, source: asset('loop', 'loop-2') },
		}));

		expect(references).toEqual([
			{ reference: { assetId: 'plate', revisionId: 'plate-1' }, ownerSlot: 'layout.frame.backgroundImage', kind: 'image' },
			{ reference: { assetId: 'loop', revisionId: 'loop-2' }, ownerSlot: 'layout.frame.mediaBackground.source', kind: 'silent-video' },
		]);
	});

	it('publishes nothing for Remote Media URLs', () => {
		const references = featureMatchLayoutGraphicAssetReferences(layoutWithFrame({
			backgroundImage: { kind: 'url', url: 'https://cdn.example.com/plate.png' },
			mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG, enabled: true, source: { kind: 'url', url: '/video/loop.mp4' } },
		}));

		expect(references).toEqual([]);
	});

	it('publishes a disabled Frame video, which the layout still carries', () => {
		// As a disabled Background Layer: a display state, so the pinned revision
		// stays resolvable for the re-enable.
		const references = featureMatchLayoutGraphicAssetReferences(layoutWithFrame({
			mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG, enabled: false, source: asset('loop', 'loop-2') },
		}));

		expect(references.map(item => item.ownerSlot)).toEqual(['layout.frame.mediaBackground.source']);
	});
});
