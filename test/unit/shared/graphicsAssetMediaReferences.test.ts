import type { GraphicItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import { createFeatureMatchLayoutComposition } from '~~/shared/featureMatchLayoutComposition';
import { getGraphicItemDefinition } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { featureMatchOverlayGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

describe('media Graphic Item exact references', () => {
	/** A pre-ADR-0020 `videoCompatibility` field reaches nothing in the reference. */
	it('indexes a silent-video item recorded before ADR-0020 as its exact revision alone', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		config.layout.composition = {
			...createFeatureMatchLayoutComposition(),
			items: [
				{
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
				} as unknown as GraphicItemConfig,
			],
		};

		expect(featureMatchOverlayGraphicAssetReferences(config)).toEqual([
			{
				reference: {
					assetId: 'video-asset',
					revisionId: 'video-revision-2',
				},
				ownerSlot: 'layout.composition.items.alpha-ident.asset',
				kind: 'silent-video',
			},
		]);
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
		config.layout.composition = {
			...createFeatureMatchLayoutComposition(),
			items: [media],
		};

		expect(featureMatchOverlayGraphicAssetReferences(config)).toEqual([
			{
				reference: { assetId: 'image-asset', revisionId: 'image-revision-1' },
				ownerSlot: 'layout.composition.items.sponsor.asset',
				kind: 'image',
			},
		]);
	});

	it('indexes an exact silent-video revision from a Graphic Group child', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const group = config.layout.composition.items.find(item => item.type === 'group');
		if (group?.type !== 'group')
			throw new Error('Expected a Graphic Group fixture');
		config.layout.composition = {
			...config.layout.composition,
			items: [
				{
					...group,
					children: [
						{
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
						} as GraphicItemConfig,
					],
				} as GraphicItemConfig,
			],
		};

		expect(featureMatchOverlayGraphicAssetReferences(config)).toEqual([
			{
				reference: {
					assetId: 'group-video-asset',
					revisionId: 'group-video-revision-7',
				},
				ownerSlot: `layout.composition.items.${group.id}.children.group-ident.asset`,
				kind: 'silent-video',
			},
		]);
	});
});
