import { describe, expect, it } from 'vitest';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { featureMatchOverlayGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

describe('feature Match Overlay exact font Graphic Asset References', () => {
	it('indexes font revisions from item, group default, child, and token typography', () => {
		const config = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
		const reference = {
			assetId: 'font-asset' as never,
			revisionId: 'font-revision-3' as never,
		};
		config.layout.items[0]!.surfaceStyle = {
			font: { kind: 'asset', reference },
		};
		const group = config.layout.items.find(item => item.type === 'graphic-group');
		if (!group || group.type !== 'graphic-group')
			throw new Error('Expected default group fixture');
		group.defaultChildSurfaceStyle = { font: { kind: 'asset', reference } };
		group.children[0]!.surfaceStyle = { font: { kind: 'asset', reference } };
		const textChild = group.children.find(child => child.graphicItem.type === 'text');
		if (textChild?.graphicItem.type === 'text') {
			textChild.graphicItem.tokenStyles = {
				name: { font: { kind: 'asset', reference } },
			};
		}

		const indexed = featureMatchOverlayGraphicAssetReferences(config)
			.filter(item => item.reference.assetId === reference.assetId);
		expect(indexed.every(item => item.kind === 'font')).toBe(true);
		const fontSlots = indexed
			.map(item => item.ownerSlot);
		expect(fontSlots).toEqual(expect.arrayContaining([
			`layout.items.${config.layout.items[0]!.id}.surfaceStyle.font`,
			`layout.items.${group.id}.defaultChildSurfaceStyle.font`,
			`layout.items.${group.id}.children.${group.children[0]!.id}.surfaceStyle.font`,
		]));
		expect(fontSlots.some(slot => slot.endsWith('.tokenStyles.name.font'))).toBe(true);
	});
});
