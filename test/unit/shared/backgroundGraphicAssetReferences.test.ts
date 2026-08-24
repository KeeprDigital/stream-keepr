import type { GraphicAssetId, GraphicAssetRevisionId } from '~~/shared/types/graphicsAsset';
import type { BackgroundLayer, BackgroundModeConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	backgroundGraphicAssetReferences,
	graphicAssetReferenceSlotPrefix,
	screenModeGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';

function assetId(value: string): GraphicAssetId {
	return value as GraphicAssetId;
}

function revisionId(value: string): GraphicAssetRevisionId {
	return value as GraphicAssetRevisionId;
}

function assetImageLayer(id: string, overrides: Partial<Extract<BackgroundLayer, { type: 'image' }>> = {}): BackgroundLayer {
	return {
		id,
		type: 'image',
		enabled: true,
		opacity: 1,
		source: { kind: 'asset', assetId: assetId('asset-1'), revisionId: revisionId('revision-1') },
		fit: 'cover',
		...overrides,
	};
}

function assetVideoLayer(id: string): BackgroundLayer {
	return {
		id,
		type: 'video',
		enabled: true,
		opacity: 1,
		source: { kind: 'asset', assetId: assetId('asset-2'), revisionId: revisionId('revision-2'), videoCompatibility: 'all-supported' },
		fit: 'cover',
		playbackRate: 1,
		loop: true,
	};
}

function config(layers: BackgroundLayer[]): BackgroundModeConfig {
	return { layers };
}

describe('backgroundGraphicAssetReferences', () => {
	it('publishes one reference per asset-sourced media layer, named by the layer that pins it', () => {
		const references = backgroundGraphicAssetReferences(config([
			assetImageLayer('plate'),
			assetVideoLayer('loop'),
		]));

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
				videoCompatibility: 'all-supported',
				videoTarget: 'chromium',
			},
		]);
	});

	it('publishes nothing for layers that pin no library revision', () => {
		const references = backgroundGraphicAssetReferences(config([
			{ id: 'wash', type: 'color', enabled: true, opacity: 1, color: '#0b1020' },
			{ id: 'grad', type: 'gradient', enabled: true, opacity: 1, gradient: 'linear-gradient(#000, #123)' },
			{ id: 'remote', type: 'image', enabled: true, opacity: 1, source: { kind: 'url', url: '/plate.png' }, fit: 'cover' },
			{ id: 'anim', type: 'animation', enabled: true, opacity: 1, animation: { effect: 'fog' } },
		]));

		expect(references).toEqual([]);
	});

	it('publishes a disabled layer, which the Screen still carries', () => {
		// Like a hidden Media Graphic Item: disabled is a display state, not a
		// removal, so the pinned revision must stay resolvable for the re-enable.
		const references = backgroundGraphicAssetReferences(config([
			assetImageLayer('plate', { enabled: false }),
		]));

		expect(references).toHaveLength(1);
	});

	it('keeps owner slots stable when the stack is reordered', () => {
		const layers = [assetImageLayer('plate'), assetVideoLayer('loop')];
		const forward = backgroundGraphicAssetReferences(config(layers));
		const reversed = backgroundGraphicAssetReferences(config([...layers].reverse()));

		expect(new Set(forward.map(item => item.ownerSlot)))
			.toEqual(new Set(reversed.map(item => item.ownerSlot)));
	});

	it('roots every discovered owner slot in the background mode’s namespace', () => {
		const references = backgroundGraphicAssetReferences(config([
			assetImageLayer('plate'),
			assetVideoLayer('loop'),
		]));

		expect(references).not.toHaveLength(0);
		for (const item of references)
			expect(item.ownerSlot.startsWith(graphicAssetReferenceSlotPrefix('background'))).toBe(true);
	});

	it('dispatches from the shared mode dispatcher, and answers nothing with no configuration', () => {
		const modeConfigs = { background: config([assetImageLayer('plate')]) };

		expect(screenModeGraphicAssetReferences('background', modeConfigs)).toHaveLength(1);
		expect(screenModeGraphicAssetReferences('background', undefined)).toEqual([]);
	});
});
