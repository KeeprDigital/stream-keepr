import type {
	BroadcastGraphicConfig,
	GraphicItemConfig,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { BroadcastGraphicsModeConfig, FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPHIC_TYPOGRAPHY, squareShapeGeometry } from '~~/shared/modules/graphics';
import { applicationGraphicFont } from '~~/shared/types/graphics';
import {
	broadcastGraphicsGraphicAssetReferences,
	featureMatchLayoutGraphicAssetReferences,
	graphicAssetReferenceSlotPrefix,
	sameScreenGraphicAssetReferences,
} from '~~/shared/utils/graphicsAssetReferences';

/**
 * A font Graphic Asset Revision is reachable from a Graphic Item's typography in
 * both hosts, and travels the same discovery walk a Media Graphic Item's reference
 * does — which is what puts it in a Screen's reference index and therefore inside
 * that Screen's Screen Output Asset Capability.
 */

function reference(assetId: string, revisionId: string): GraphicAssetReference {
	return {
		assetId: assetId as GraphicAssetReference['assetId'],
		revisionId: revisionId as GraphicAssetReference['revisionId'],
	};
}

const barlow = reference('font-asset-1', 'font-revision-1');
const grotesk = reference('font-asset-2', 'font-revision-2');

function text(id: string, overrides: Partial<TextGraphicItemConfig> = {}): TextGraphicItemConfig {
	return {
		type: 'text',
		id,
		label: id,
		visible: true,
		anchor: 'top-left',
		x: 0,
		y: 0,
		width: 200,
		height: 100,
		text: 'Text',
		typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY },
		overflowPolicy: 'clip',
		minFontSize: 12,
		...overrides,
	};
}

function assetFontText(id: string, font: GraphicAssetReference): TextGraphicItemConfig {
	return text(id, { typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, font: { kind: 'asset', reference: font } } });
}

function graphic(items: GraphicItemConfig[]): BroadcastGraphicsModeConfig {
	return { graphics: [{ id: 'lower-third', name: 'Lower Third', items } as BroadcastGraphicConfig] };
}

function layout(items: GraphicItemConfig[]): FeatureMatchLayoutConfig {
	return {
		frame: {},
		sources: [],
		composition: { id: 'composition', name: 'Composition', items },
	} as unknown as FeatureMatchLayoutConfig;
}

describe('font Graphic Asset References in the shared graphics vocabulary', () => {
	it('publishes a Broadcast Graphic text item’s library font, named by the item that pins it', () => {
		expect(broadcastGraphicsGraphicAssetReferences(graphic([assetFontText('headline', barlow)])))
			.toEqual([{
				reference: barlow,
				ownerSlot: 'graphics.lower-third.items.headline.typography.font',
				kind: 'font',
			}]);
	});

	it('publishes a Feature Match Layout text item’s library font under the layout prefix', () => {
		const references = featureMatchLayoutGraphicAssetReferences(layout([assetFontText('player1-name', barlow)]));

		expect(references).toEqual([{
			reference: barlow,
			ownerSlot: 'layout.composition.items.player1-name.typography.font',
			kind: 'font',
		}]);
		for (const item of references)
			expect(item.ownerSlot.startsWith(graphicAssetReferenceSlotPrefix('feature-match-overlay'))).toBe(true);
	});

	it('publishes nothing for an application font selection', () => {
		expect(broadcastGraphicsGraphicAssetReferences(graphic([
			text('headline', {
				typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, font: applicationGraphicFont('inter') },
			}),
		]))).toEqual([]);
	});

	it('publishes a Graphic Placeholder Style’s library font under its own placeholder key', () => {
		expect(broadcastGraphicsGraphicAssetReferences(graphic([
			text('headline', { placeholderStyles: { playerName: { font: { kind: 'asset', reference: grotesk } } } }),
		]))).toEqual([{
			reference: grotesk,
			ownerSlot: 'graphics.lower-third.items.headline.placeholderStyles.playerName.font',
			kind: 'font',
		}]);
	});

	it('publishes the library font of a context-gated Graphic Item’s typography', () => {
		const clock = {
			type: 'clock',
			id: 'match-clock',
			label: 'Clock',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 200,
			height: 60,
			typography: { ...DEFAULT_GRAPHIC_TYPOGRAPHY, font: { kind: 'asset', reference: barlow } },
			overflowPolicy: 'clip',
			minFontSize: 12,
		} as GraphicItemConfig;

		expect(featureMatchLayoutGraphicAssetReferences(layout([clock])).map(item => item.ownerSlot))
			.toEqual(['layout.composition.items.match-clock.typography.font']);
	});

	it('publishes a Graphic Group child’s library font under the child’s own slot', () => {
		const references = broadcastGraphicsGraphicAssetReferences(graphic([{
			type: 'group',
			id: 'cluster',
			label: 'cluster',
			visible: true,
			anchor: 'top-left',
			x: 0,
			y: 0,
			width: 400,
			height: 200,
			arrangement: 'row',
			padding: 0,
			gap: 0,
			align: 'stretch',
			justify: 'start',
			clip: false,
			geometry: squareShapeGeometry(),
			children: [assetFontText('badge-text', grotesk)],
		}]));

		expect(references).toEqual([{
			reference: grotesk,
			ownerSlot: 'graphics.lower-third.items.cluster.children.badge-text.typography.font',
			kind: 'font',
		}]);
	});

	it('keeps a font reference distinct from an identical image reference at the same slot depth', () => {
		// `kind` is part of what makes two reference sets the same, so a slot that
		// changed from an image to a font must not read as unchanged.
		const asFont = broadcastGraphicsGraphicAssetReferences(graphic([assetFontText('headline', barlow)]));
		const asImage = asFont.map(item => ({ ...item, kind: 'image' as const }));

		expect(sameScreenGraphicAssetReferences(asFont, asImage)).toBe(false);
	});
});
