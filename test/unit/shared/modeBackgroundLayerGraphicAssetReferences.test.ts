import { describe, expect, it } from 'vitest';
import {
	GRAPHIC_ASSET_REFERENCING_SCREEN_MODES,
	graphicAssetReferenceSlotPrefix,
	screenModeGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';
import { MODES_WITH_A_BACKGROUND_LAYER_STACK } from '~~/test/helpers/backgroundLayerModes';
import { assetImageLayer, assetVideoLayer, layersPinningNoAsset } from '~~/test/helpers/backgroundLayers';

describe.each(MODES_WITH_A_BACKGROUND_LAYER_STACK)('the %s mode’s own Background Layer stack', (mode) => {
	it('publishes one reference per asset-sourced media layer, named by the mode and the layer that pins it', () => {
		const references = screenModeGraphicAssetReferences(mode, {
			[mode]: {
				backgroundLayers: [
					assetImageLayer('plate'),
					assetVideoLayer('loop'),
				],
			},
		});

		expect(references).toEqual([
			{
				reference: { assetId: 'asset-1', revisionId: 'revision-1' },
				ownerSlot: `${mode}.backgroundLayers.plate.source`,
				kind: 'image',
			},
			{
				reference: { assetId: 'asset-2', revisionId: 'revision-2' },
				ownerSlot: `${mode}.backgroundLayers.loop.source`,
				kind: 'silent-video',
			},
		]);
	});

	it('publishes nothing for layers that pin no library revision, a URL source included', () => {
		expect(screenModeGraphicAssetReferences(mode, {
			[mode]: {
				backgroundLayers: layersPinningNoAsset(),
			},
		})).toEqual([]);
	});

	it('answers nothing for a stored fragment with no stack, or no configuration at all', () => {
		expect(screenModeGraphicAssetReferences(mode, { [mode]: {} })).toEqual([]);
		expect(screenModeGraphicAssetReferences(mode, {})).toEqual([]);
		expect(screenModeGraphicAssetReferences(mode, undefined)).toEqual([]);
	});

	it('roots its slots in its own namespace, which no other referencing mode claims', () => {
		// Every mode names the field `backgroundLayers`, so only the namespace keeps
		// one mode's write from clearing another's rows.
		const references = screenModeGraphicAssetReferences(mode, {
			[mode]: {
				backgroundLayers: [
					assetImageLayer('plate'),
				],
			},
		});

		expect(references).toHaveLength(1);
		for (const item of references) {
			for (const other of GRAPHIC_ASSET_REFERENCING_SCREEN_MODES)
				expect(item.ownerSlot.startsWith(graphicAssetReferenceSlotPrefix(other))).toBe(other === mode);
		}
	});

	it('reads only its own mode’s stack from a Screen holding every mode’s configuration', () => {
		const others = Object.fromEntries(MODES_WITH_A_BACKGROUND_LAYER_STACK
			.filter(other => other !== mode)
			.map(other => [
				other,
				{
					backgroundLayers: [
						assetImageLayer(`${other}-plate`),
					],
				},
			]));

		expect(screenModeGraphicAssetReferences(mode, others)).toEqual([]);
	});
});
