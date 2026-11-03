import type { AlignEdge } from '~~/app/modules/graphics/canvasAlignment';
import type { BroadcastGraphicConfig, GraphicGroupItemConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { alignableLayers, alignLayers, distributeLayers } from '~~/app/modules/feature-match-overlay/layerAlignment';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

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

interface Shape {
	group?: Partial<GraphicGroupItemConfig>;
	title?: Partial<GraphicItemConfig>;
}

/**
 * A Source Item at (100, 100) 200×100; Graphic Items "title" at (500, 400)
 * 100×50 and "badge" at (900, 700) 60×60; and a canvas-arranged group "cluster"
 * at (50, 60) 400×300 with padding 4, whose padded box holds "child" at
 * (10, 20) 30×40 and "sibling" at (200, 100) 50×50.
 */
function layoutOf(shape: Shape = {}): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	const size = { canvasWidth: 1920, canvasHeight: 1080 };
	let composition: BroadcastGraphicConfig = { ...base.composition, items: [] };
	composition = addGraphicItem(composition, { kind: 'text', id: 'title', ...size }).graphic;
	composition = addGraphicItem(composition, { kind: 'shape', id: 'badge', ...size }).graphic;
	composition = addGraphicItem(composition, { kind: 'group', id: 'cluster', ...size }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'shape', groupId: 'cluster', id: 'child' }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'shape', groupId: 'cluster', id: 'sibling' }).graphic;
	const place = {
		title: [500, 400, 100, 50],
		badge: [900, 700, 60, 60],
		child: [10, 20, 30, 40],
		sibling: [200, 100, 50, 50],
	} as const;
	const rect = (id: keyof typeof place) => {
		const [x, y, width, height] = place[id];
		return { x, y, width, height };
	};
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
			...composition,
			items: composition.items.map((item) => {
				if (item.type === 'group') {
					return {
						...item,
						arrangement: 'canvas' as const,
						padding: 4,
						x: 50,
						y: 60,
						width: 400,
						height: 300,
						children: item.children.map(child => ({
							...child,
							...rect(child.id as 'child' | 'sibling'),
						})),
						...shape.group,
					};
				}
				return {
					...item,
					...rect(item.id as 'title' | 'badge'),
					...(item.id === 'title'
						? shape.title
						: {}),
				} as GraphicItemConfig;
			}),
		},
	};
}

describe('feature match layout layer alignment', () => {
	it.each<[string, Shape, readonly { type: 'source' | 'item'; itemId: string }[], AlignEdge, unknown[]]>([
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
	])('aligns %s', (_, shape, layers, edge, moved) => {
		expect(alignLayers(layoutOf(shape), layers, CANVAS, edge)).toEqual(moved);
	});

	it.each<[string, Shape, readonly { type: 'source' | 'item'; itemId: string }[], 'x' | 'y', unknown[]]>([
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
	])('distributes %s', (_, shape, layers, axis, moved) => {
		expect(distributeLayers(layoutOf(shape), layers, axis)).toEqual(moved);
	});

	it.each<[string, Shape, readonly { type: 'source' | 'item'; itemId: string }[], unknown[]]>([
		[
			'every layer on the canvas or in a canvas group',
			{},
			[SOURCE, CHILD, TITLE],
			[SOURCE, CHILD, TITLE],
		],
		[
			'no child of a row or column group',
			{
				group: { arrangement: 'column' },
			},
			[SOURCE, CHILD, TITLE],
			[SOURCE, TITLE],
		],
		[
			'the children of one rotated group alone',
			{
				group: { rotation: 30 },
			},
			[CHILD, SIBLING],
			[CHILD, SIBLING],
		],
		[
			'no child of a rotated group among canvas layers',
			{
				group: { rotation: 30 },
			},
			[CHILD, TITLE],
			[TITLE],
		],
		[
			'no layer that has left the layout',
			{},
			[
				SOURCE,
				{ type: 'item', itemId: 'gone' },
			],
			[SOURCE],
		],
	])('aligns %s', (_, shape, layers, alignable) => {
		expect(alignableLayers(layoutOf(shape), layers)).toEqual(alignable);
	});
});
