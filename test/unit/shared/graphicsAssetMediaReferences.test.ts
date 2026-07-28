import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import {
	featureMatchOverlayGraphicAssetReferences,
	screenGraphicAssetReferenceTargetCompatibility,
} from '~~/shared/utils/graphicsAssetReferences';

describe('media Graphic Item exact references', () => {
	it('carries the declared Screen output target into authoritative reference validation', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.items = [{
			id: 'alpha-ident',
			type: 'widget',
			label: 'Alpha ident',
			visible: true,
			x: 0,
			y: 0,
			width: 640,
			height: 360,
			widget: {
				type: 'media',
				asset: {
					assetId: 'video-asset' as never,
					revisionId: 'video-revision-2' as never,
				},
				mediaKind: 'silent-video',
				fit: 'contain',
				opacity: 1,
				borderRadius: 0,
				videoCompatibility: 'chromium-transparency',
				videoTarget: 'chromium',
			},
		}];

		expect(featureMatchOverlayGraphicAssetReferences(config)).toEqual([{
			reference: {
				assetId: 'video-asset',
				revisionId: 'video-revision-2',
			},
			ownerSlot: 'layout.items.alpha-ident.widget.asset',
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}]);
	});

	it('blocks a restricted reference unless the authored Screen output target is Chromium', () => {
		const restricted = {
			reference: {
				assetId: 'video-asset' as never,
				revisionId: 'video-revision-2' as never,
			},
			ownerSlot: 'layout.items.alpha-ident.widget.asset',
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
		} as const;

		expect(screenGraphicAssetReferenceTargetCompatibility({
			...restricted,
			videoTarget: 'safari',
		})).toEqual({
			outcome: 'blocked',
			code: 'vp9-alpha-chromium-required',
		});
		expect(screenGraphicAssetReferenceTargetCompatibility({
			...restricted,
			videoTarget: 'chromium',
		})).toEqual({ outcome: 'compatible' });
	});
});
