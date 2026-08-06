import type { GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import {
	featureMatchOverlayGraphicAssetReferences,
	sameScreenGraphicAssetReferences,
	screenGraphicAssetReferenceTargetCompatibility,
} from '~~/shared/utils/graphicsAssetReferences';

describe('media Graphic Item exact references', () => {
	it('carries the pinned revision target into authoritative reference validation', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.composition = {
			...createFeatureMatchLayoutComposition(),
			items: [{
				...getGraphicItemDefinition('media').createDefault({
					id: 'alpha-ident',
					label: 'Alpha ident',
					canvasWidth: 1920,
					canvasHeight: 1080,
				}),
				mediaKind: 'silent-video',
				asset: {
					assetId: 'video-asset' as never,
					revisionId: 'video-revision-2' as never,
				},
				videoCompatibility: 'chromium-transparency',
			} as GraphicItemConfig],
		};

		expect(featureMatchOverlayGraphicAssetReferences(config)).toEqual([{
			reference: {
				assetId: 'video-asset',
				revisionId: 'video-revision-2',
			},
			ownerSlot: 'layout.composition.items.alpha-ident.asset',
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}]);
	});

	it('publishes the shared item tree under the Feature Match Overlay"s own slot prefix', () => {
		// The `layout.` prefix is load-bearing: a write scopes its reference delete to
		// it, and a Screen Output resolves only the prefix for its Screen's current
		// mode. A shared tree publishing outside it would have its references orphaned
		// by the next write.
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const media = {
			...getGraphicItemDefinition('media').createDefault({
				id: 'sponsor',
				label: 'Sponsor',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			asset: { assetId: 'image-asset' as never, revisionId: 'image-revision-1' as never },
		} as GraphicItemConfig;
		config.layout.composition = { ...createFeatureMatchLayoutComposition(), items: [media] };

		expect(featureMatchOverlayGraphicAssetReferences(config)).toEqual([{
			reference: { assetId: 'image-asset', revisionId: 'image-revision-1' },
			ownerSlot: 'layout.composition.items.sponsor.asset',
			kind: 'image',
		}]);
	});

	it('carries a shared silent-video reference"s pinned compatibility and assumed target', () => {
		// The Chromium assumption is shared by both hosts on purpose: a graphics Screen
		// Output is consumed as a browser source in Chromium-based capture, and neither
		// host offers a control that would let an author say otherwise.
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const video = {
			...getGraphicItemDefinition('media').createDefault({
				id: 'ident',
				label: 'Ident',
				canvasWidth: 1920,
				canvasHeight: 1080,
			}),
			mediaKind: 'silent-video',
			asset: { assetId: 'video-asset' as never, revisionId: 'video-revision-9' as never },
			videoCompatibility: 'chromium-transparency',
		} as GraphicItemConfig;
		config.layout.composition = { ...createFeatureMatchLayoutComposition(), items: [video] };

		expect(featureMatchOverlayGraphicAssetReferences(config)).toEqual([{
			reference: { assetId: 'video-asset', revisionId: 'video-revision-9' },
			ownerSlot: 'layout.composition.items.ident.asset',
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		}]);
	});

	it('indexes an exact silent-video revision from a Graphic Group child', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const group = config.layout.composition.items.find(item => item.type === 'group');
		if (group?.type !== 'group')
			throw new Error('Expected a Graphic Group fixture');
		config.layout.composition = {
			...config.layout.composition,
			items: [{
				...group,
				children: [{
					...getGraphicItemDefinition('media').createDefault({
						id: 'group-ident',
						label: 'Group ident',
						canvasWidth: 1920,
						canvasHeight: 1080,
					}),
					mediaKind: 'silent-video',
					asset: {
						assetId: 'group-video-asset' as never,
						revisionId: 'group-video-revision-7' as never,
					},
					videoCompatibility: 'chromium-transparency',
				} as GraphicItemConfig],
			} as GraphicItemConfig],
		};

		expect(featureMatchOverlayGraphicAssetReferences(config)).toEqual([{
			reference: {
				assetId: 'group-video-asset',
				revisionId: 'group-video-revision-7',
			},
			ownerSlot: `layout.composition.items.${group.id}.children.group-ident.asset`,
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
			ownerSlot: 'layout.items.alpha-ident.asset',
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

	it('treats compatibility and output-target relabelling as a reference change', () => {
		const reference = {
			reference: {
				assetId: 'video-asset' as never,
				revisionId: 'video-revision-2' as never,
			},
			ownerSlot: 'layout.items.alpha-ident.asset',
			kind: 'silent-video',
			videoCompatibility: 'chromium-transparency',
			videoTarget: 'chromium',
		} as const;

		expect(sameScreenGraphicAssetReferences(
			[reference],
			[{ ...reference, videoCompatibility: 'all-supported' }],
		)).toBe(false);
		expect(sameScreenGraphicAssetReferences(
			[reference],
			[{ ...reference, videoTarget: 'safari' }],
		)).toBe(false);
	});
});
