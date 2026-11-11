import type { AlignEdge } from '~~/app/modules/graphics/canvasAlignment';
import type { GraphicGroupItemConfig, ShapeGraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_LAYOUT_EDITOR_TREE } from '~~/app/modules/feature-match-overlay/editorHost';
import { alignLayers, canAlignLayers, canDistributeLayers, distributeLayers } from '~~/app/modules/graphics/editor/layerAlignment';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { group, shape } from '~~/test/helpers/graphicsComposition';

/**
 * Which of the Feature Match Overlay editor's selected layers align and
 * distribute, and in which container's pixels (#919).
 */

const CANVAS = { width: 1920, height: 1080 };
const SOURCE = { type: 'source', itemId: 'main-source' } as const;
const TITLE = { type: 'item', itemId: 'title' } as const;
const BADGE = { type: 'item', itemId: 'badge' } as const;
const CHILD = { type: 'item', itemId: 'child' } as const;
const SIBLING = { type: 'item', itemId: 'sibling' } as const;
const CLUSTER = { type: 'item', itemId: 'cluster' } as const;

interface Variant {
	group?: Partial<GraphicGroupItemConfig>;
	title?: Partial<ShapeGraphicItemConfig>;
}

/**
 * A Source Item at (100, 100) 200×100; Graphic Items "title" at (500, 400)
 * 100×50 and "badge" at (900, 700) 60×60; and a canvas-arranged group "cluster"
 * at (50, 60) 400×300 with padding 4, whose padded box holds "child" at
 * (10, 20) 30×40 and "sibling" at (200, 100) 50×50.
 */
function layoutOf(variant: Variant = {}): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	return {
		...base,
		sources: base.sources.map(source => source.id === 'main-source'
			? {
					...source,
					x: 100,
					y: 100,
					width: 200,
					height: 100,
				}
			: source),
		composition: {
			...base.composition,
			items: [
				shape('title', {
					x: 500,
					y: 400,
					width: 100,
					height: 50,
					...variant.title,
				}),
				shape('badge', {
					x: 900,
					y: 700,
					width: 60,
					height: 60,
				}),
				group('cluster', [
					shape('child', { x: 10, y: 20, width: 30, height: 40 }),
					shape('sibling', {
						x: 200,
						y: 100,
						width: 50,
						height: 50,
					}),
				], {
					arrangement: 'canvas',
					padding: 4,
					x: 50,
					y: 60,
					width: 400,
					height: 300,
					...variant.group,
				}),
			],
		},
	};
}

describe('feature match layout layer alignment', () => {
	it.each<[string, Variant, readonly { type: 'source' | 'item'; itemId: string }[], AlignEdge, unknown[]]>([
		[
			'Source Items and Graphic Items together, to the bounds they cover, moving none already there (E8, E10)',
			{},
			[SOURCE, TITLE, BADGE],
			'left',
			[
				{ layer: TITLE, x: 100, y: 400 },
				{ layer: BADGE, x: 100, y: 700 },
			],
		],
		[
			'one layer to the canvas (E10)',
			{},
			[TITLE],
			'right',
			[
				{ layer: TITLE, x: 1820, y: 400 },
			],
		],
		[
			'one group child to its group\'s padded box',
			{},
			[CHILD],
			'bottom',
			[
				{ layer: CHILD, x: 10, y: 252 },
			],
		],
		[
			'a group child among canvas layers, by where it sits on the canvas',
			{},
			[CHILD, TITLE],
			'top',
			[
				{ layer: TITLE, x: 500, y: 84 },
			],
		],
		[
			'a group child among canvas layers, moving it within its group',
			{},
			[CHILD, TITLE],
			'bottom',
			[
				{ layer: CHILD, x: 10, y: 346 },
			],
		],
		[
			'children of a rotated group within their group',
			{
				group: { rotation: 30 },
			},
			[CHILD, SIBLING],
			'left',
			[
				{ layer: SIBLING, x: 10, y: 100 },
			],
		],
		[
			'a rotated layer by the box it turns into',
			{
				title: { rotation: 90, anchor: 'center' },
			},
			[TITLE, SOURCE],
			'left',
			[
				{ layer: TITLE, x: 75, y: 400 },
			],
		],
		[
			'a group as one layer, its children moving with it',
			{},
			[CLUSTER, BADGE],
			'top',
			[
				{ layer: BADGE, x: 900, y: 60 },
			],
		],
		[
			'none of a row group\'s children, which their group places',
			{
				group: { arrangement: 'row' },
			},
			[CHILD, TITLE, BADGE],
			'left',
			[
				{ layer: BADGE, x: 500, y: 700 },
			],
		],
		[
			'none of a rotated group\'s children among canvas layers',
			{
				group: { rotation: 30 },
			},
			[CHILD, TITLE, BADGE],
			'left',
			[
				{ layer: BADGE, x: 500, y: 700 },
			],
		],
	])('aligns %s', (_, variant, layers, edge, moved) => {
		expect(alignLayers(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layoutOf(variant), layers, CANVAS, edge)).toEqual(moved);
	});

	it.each<[string, Variant, readonly { type: 'source' | 'item'; itemId: string }[], 'x' | 'y', unknown[]]>([
		[
			'across the canvas, a group child by where it sits on it',
			{},
			[SOURCE, TITLE, CHILD],
			'x',
			[
				{ layer: SOURCE, x: 197, y: 100 },
			],
		],
		[
			'down the canvas',
			{},
			[SOURCE, TITLE, BADGE],
			'y',
			[
				{ layer: TITLE, x: 500, y: 425 },
			],
		],
		[
			'nothing with fewer than three that move',
			{
				group: { arrangement: 'column' },
			},
			[CHILD, TITLE, BADGE],
			'x',
			[],
		],
	])('distributes %s', (_, variant, layers, axis, moved) => {
		expect(distributeLayers(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layoutOf(variant), layers, axis)).toEqual(moved);
	});

	const ROW = {
		group: { arrangement: 'row' as const },
	};
	const ROTATED = {
		group: { rotation: 30 },
	};

	it.each<[string, Variant, readonly { type: 'source' | 'item'; itemId: string }[], boolean, boolean]>([
		[
			'one layer, to the canvas',
			{},
			[TITLE],
			true,
			false,
		],
		[
			'a group child alone, to its group',
			{},
			[CHILD],
			true,
			false,
		],
		[
			'three on the canvas or in a canvas group',
			{},
			[SOURCE, CHILD, TITLE],
			true,
			true,
		],
		[
			'children of one rotated group, within it',
			ROTATED,
			[CHILD, SIBLING],
			true,
			false,
		],
		[
			'a row child alone, which its group places',
			ROW,
			[CHILD],
			false,
			false,
		],
		[
			'three, one a row child, leaving two',
			ROW,
			[SOURCE, CHILD, TITLE],
			true,
			false,
		],
		[
			'a layer beside a row child, with nothing to line up with',
			ROW,
			[SOURCE, CHILD],
			false,
			false,
		],
		[
			'three, one a rotated group\'s child among canvas layers, leaving two',
			ROTATED,
			[CHILD, TITLE, BADGE],
			true,
			false,
		],
	])('offers to align and distribute %s', (_, variant, layers, aligns, distributes) => {
		const layout = layoutOf(variant);

		expect([
			canAlignLayers(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, layers),
			canDistributeLayers(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, layers),
		]).toEqual([aligns, distributes]);
	});
});
