import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	GRAPHIC_ASSET_REFERENCING_SCREEN_MODES,
	graphicAssetReferenceSlotPrefix,
	screenModeGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';
import { MODES_WITH_A_BACKGROUND_LAYER_STACK } from '~~/test/helpers/backgroundLayerModes';

function assetImageLayer(id: string): BackgroundLayer {
	return {
		id,
		type: 'image',
		enabled: true,
		opacity: 1,
		source: {
			kind: 'asset',
			assetId: 'asset-1' as GraphicAssetId,
			revisionId: 'revision-1' as GraphicAssetRevisionId,
		},
		fit: 'cover',
	};
}

function assetVideoLayer(id: string): BackgroundLayer {
	return {
		id,
		type: 'video',
		enabled: true,
		opacity: 1,
		source: {
			kind: 'asset',
			assetId: 'asset-2' as GraphicAssetId,
			revisionId: 'revision-2' as GraphicAssetRevisionId,
		},
		fit: 'cover',
		playbackRate: 1,
		loop: true,
	};
}

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
		const references = screenModeGraphicAssetReferences(mode, {
			[mode]: {
				backgroundLayers: [
					{
						id: 'wash',
						type: 'color',
						enabled: true,
						opacity: 1,
						color: '#0b1020',
					},
					{
						id: 'grad',
						type: 'gradient',
						enabled: true,
						opacity: 1,
						gradient: 'linear-gradient(#000, #123)',
					},
					{
						id: 'plate',
						type: 'image',
						enabled: true,
						opacity: 1,
						source: { kind: 'url', url: 'https://example.com/plate.png' },
						fit: 'cover',
					},
					{
						id: 'loop',
						type: 'video',
						enabled: true,
						opacity: 1,
						source: { kind: 'url', url: 'https://example.com/loop.webm' },
						fit: 'cover',
						playbackRate: 1,
						loop: true,
					},
					{
						id: 'anim',
						type: 'animation',
						enabled: true,
						opacity: 1,
						animation: { effect: 'fog' },
					},
				],
			},
		});

		expect(references).toEqual([]);
	});

	it('answers nothing for a stored fragment with no stack, or no configuration at all', () => {
		// Stored mode configurations are legitimately partial: PATCH writes
		// fragments, so a mode edited only elsewhere has no `backgroundLayers` key.
		expect(screenModeGraphicAssetReferences(mode, { [mode]: {} })).toEqual([]);
		expect(screenModeGraphicAssetReferences(mode, {})).toEqual([]);
		expect(screenModeGraphicAssetReferences(mode, undefined)).toEqual([]);
	});

	it('roots its slots in its own namespace, which no other referencing mode claims', () => {
		// Every one of these modes names the field `backgroundLayers`, so the field
		// alone cannot keep them apart: a Card write scoped to it would delete the
		// Deck stack's rows, and a Card output would resolve them.
		const references = screenModeGraphicAssetReferences(mode, {
			[mode]: {
				backgroundLayers: [
					assetImageLayer('plate'),
				],
			},
		});

		expect(references).toHaveLength(1);
		for (const item of references) {
			for (const other of GRAPHIC_ASSET_REFERENCING_SCREEN_MODES) {
				expect(item.ownerSlot.startsWith(graphicAssetReferenceSlotPrefix(other)))
					.toBe(other === mode);
			}
		}
	});

	it('reads only its own mode’s stack from a Screen holding every mode’s configuration', () => {
		const others = Object.fromEntries(
			MODES_WITH_A_BACKGROUND_LAYER_STACK
				.filter(other => other !== mode)
				.map(other => [
					other,
					{
						backgroundLayers: [
							assetImageLayer(`${other}-plate`),
						],
					},
				]),
		);

		expect(screenModeGraphicAssetReferences(mode, others)).toEqual([]);
	});
});
