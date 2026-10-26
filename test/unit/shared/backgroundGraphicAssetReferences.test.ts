import type { BackgroundModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	backgroundGraphicAssetReferences,
	graphicAssetReferenceSlotPrefix,
	screenModeGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';
import { assetImageLayer, assetVideoLayer, layersPinningNoAsset } from '~~/test/helpers/backgroundLayers';

// The Background Screen's own stack. Plain overlay modes' `backgroundLayers`
// are covered in modeBackgroundLayerGraphicAssetReferences.test.ts.
describe('backgroundGraphicAssetReferences', () => {
	it('publishes one reference per asset-sourced media layer, named by the layer that pins it', () => {
		const references = backgroundGraphicAssetReferences({ layers: [assetImageLayer('plate'), assetVideoLayer('loop')] });

		expect(references).toEqual([
			{
				reference: { assetId: 'asset-1', revisionId: 'revision-1' },
				ownerSlot: 'layers.plate.source',
				kind: 'image',
			},
			{
				reference: { assetId: 'asset-2', revisionId: 'revision-2' },
				ownerSlot: 'layers.loop.source',
				kind: 'silent-video',
			},
		]);
		for (const item of references)
			expect(item.ownerSlot.startsWith(graphicAssetReferenceSlotPrefix('background'))).toBe(true);
	});

	it('publishes nothing for layers that pin no library revision', () => {
		expect(backgroundGraphicAssetReferences({ layers: layersPinningNoAsset() })).toEqual([]);
	});

	it('publishes a disabled layer, whose revision must stay resolvable for the re-enable', () => {
		expect(backgroundGraphicAssetReferences({ layers: [assetImageLayer('plate', { enabled: false })] })).toHaveLength(1);
	});

	it('keeps owner slots stable when the stack is reordered', () => {
		const layers = [assetImageLayer('plate'), assetVideoLayer('loop')];
		const forward = backgroundGraphicAssetReferences({ layers });
		const reversed = backgroundGraphicAssetReferences({ layers: [...layers].reverse() });

		expect(new Set(forward.map(item => item.ownerSlot))).toEqual(new Set(reversed.map(item => item.ownerSlot)));
	});

	it('dispatches from the shared mode dispatcher, and answers nothing with no configuration', () => {
		expect(screenModeGraphicAssetReferences('background', { background: { layers: [assetImageLayer('plate')] } })).toHaveLength(1);
		expect(screenModeGraphicAssetReferences('background', undefined)).toEqual([]);
	});

	it('answers nothing for a stored fragment that carries no layers key at all', () => {
		expect(backgroundGraphicAssetReferences({} as BackgroundModeConfig)).toEqual([]);
	});
});
