import type { FeatureMatchGraphicGroupItemConfig, FeatureMatchLayoutConfig, FeatureMatchLayoutItemConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	addGroupChild,
	addItem,
	bringGroupChildToFront,
	bringItemToFront,
	convertGroupArrangement,
	createGroupChild,
	createLayoutItem,
	moveGroupChildOrder,
	moveItemOrder,
	patchFrame,
	patchGroup,
	patchGroupChild,
	patchGroupChildGraphicItem,
	patchGroupChildRectFromAnchor,
	patchItem,
	patchItemRectFromAnchor,
	removeGroupChild,
	removeItem,
	sendGroupChildToBack,
	sendItemToBack,
	setItemOrder,
} from '~~/app/modules/feature-match-overlay/layout';
import {
	DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
	normalizeFeatureMatchLayout,
} from '~~/shared/types/screenConfig';

function graphicItemItem(overrides: Partial<Extract<FeatureMatchLayoutItemConfig, { type: 'graphic-item' }>> = {}): FeatureMatchLayoutItemConfig {
	return {
		id: 'w1',
		type: 'graphic-item',
		label: 'GraphicItem',
		visible: true,
		x: 100,
		y: 50,
		width: 100,
		height: 40,
		graphicItem: { type: 'clock' },
		...overrides,
	};
}

function groupItem(overrides: Partial<FeatureMatchGraphicGroupItemConfig> = {}): FeatureMatchLayoutItemConfig {
	return {
		id: 'g1',
		type: 'graphic-group',
		label: 'Group',
		visible: true,
		x: 0,
		y: 0,
		width: 500,
		height: 100,
		arrangement: { mode: 'row', padding: 10, gap: 8, align: 'stretch', justify: 'start' },
		children: [
			{ id: 'c1', label: 'Child', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'stack', sizing: { mode: 'fixed', size: 120 } } },
		],
		...overrides,
	};
}

function layoutOf(items: FeatureMatchLayoutItemConfig[]): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG);
	return { ...base.layout, items };
}

function group(layout: FeatureMatchLayoutConfig, id = 'g1'): FeatureMatchGraphicGroupItemConfig {
	return layout.items.find(item => item.id === id) as FeatureMatchGraphicGroupItemConfig;
}

describe('feature-match-overlay layout writer', () => {
	it('migrates persisted legacy Widget shapes only at the normalizer boundary', () => {
		const legacy = {
			...layoutOf([]),
			items: [{
				id: 'legacy-top-level-image',
				type: 'widget',
				label: 'Top-level image',
				visible: true,
				x: 10,
				y: 20,
				width: 200,
				height: 100,
				widget: {
					type: 'image',
					asset: { assetId: 'asset-1', revisionId: 'revision-2' },
					fit: 'cover',
					opacity: 0.6,
					borderRadius: 12,
				},
			}, {
				id: 'legacy-group',
				type: 'widget-group',
				label: 'Legacy group',
				visible: true,
				x: 0,
				y: 0,
				width: 100,
				height: 100,
				arrangement: { mode: 'canvas' },
				children: [{
					id: 'legacy-clock',
					type: 'widget',
					label: 'Clock',
					visible: true,
					widget: { type: 'clock' },
					layout: { mode: 'canvas', x: 0, y: 0, width: 100, height: 40 },
				}, {
					id: 'legacy-image',
					type: 'widget',
					label: 'Image',
					visible: true,
					widget: {
						type: 'image',
						fit: 'contain',
						opacity: 0.8,
						borderRadius: 8,
					},
					layout: { mode: 'canvas', x: 0, y: 40, width: 100, height: 60 },
				}],
			}],
		} as unknown as FeatureMatchLayoutConfig;

		const normalized = normalizeFeatureMatchLayout(legacy);

		expect(normalized.items).toEqual([
			expect.objectContaining({
				id: 'legacy-top-level-image',
				type: 'media',
				asset: { assetId: 'asset-1', revisionId: 'revision-2' },
				mediaKind: 'image',
				fit: 'cover',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				opacity: 0.6,
				clipGeometry: expect.objectContaining({
					topLeft: { kind: 'rounded', size: 12 },
				}),
			}),
			expect.objectContaining({
				type: 'graphic-group',
				children: [
					expect.objectContaining({
						type: 'graphic-item',
						graphicItem: { type: 'clock' },
					}),
					expect.objectContaining({
						id: 'legacy-image',
						type: 'media',
						mediaKind: 'image',
						focalPosition: { horizontal: 0.5, vertical: 0.5 },
						opacity: 0.8,
					}),
				],
			}),
		]);
		expect(JSON.stringify(normalized)).not.toContain('"widget"');
	});

	describe('id addressing and narrowing', () => {
		it('patches an item by id, leaving siblings untouched', () => {
			const layout = layoutOf([graphicItemItem({ id: 'a' }), graphicItemItem({ id: 'b' })]);

			const next = patchItem(layout, 'b', { label: 'Renamed' });

			expect(next.items.find(item => item.id === 'b')!.label).toBe('Renamed');
			expect(next.items.find(item => item.id === 'a')).toBe(layout.items[0]);
		});

		it('returns the same layout reference for an unknown id', () => {
			const layout = layoutOf([graphicItemItem()]);

			expect(patchItem(layout, 'missing', { label: 'x' })).toBe(layout);
		});

		it('patchGroup is a no-op (same reference) on a non-group item', () => {
			const layout = layoutOf([graphicItemItem()]);

			expect(patchGroup(layout, 'w1', { label: 'x' })).toBe(layout);
		});

		it('patchGroupChildGraphicItem narrows the group and child without casts', () => {
			const layout = layoutOf([groupItem()]);

			const next = patchGroupChildGraphicItem(layout, 'g1', 'c1', { type: 'clock', showLabel: true } as never);

			expect(group(next).children[0]!.graphicItem).toMatchObject({ type: 'clock', showLabel: true });
		});

		it('patchGroupChild on a graphicItem item is a no-op', () => {
			const layout = layoutOf([graphicItemItem()]);

			expect(patchGroupChild(layout, 'w1', 'c1', { label: 'x' })).toBe(layout);
		});
	});

	describe('frame', () => {
		it('patchFrame merges frame fields without touching items', () => {
			const layout = layoutOf([graphicItemItem()]);

			const next = patchFrame(layout, { backgroundColor: '#123456' });

			expect(next.frame.backgroundColor).toBe('#123456');
			expect(next.items).toBe(layout.items);
		});
	});

	describe('membership', () => {
		it('addItem appends and removeItem removes by id', () => {
			const layout = layoutOf([graphicItemItem({ id: 'a' })]);

			const withB = addItem(layout, graphicItemItem({ id: 'b' }));
			expect(withB.items.map(item => item.id)).toEqual(['a', 'b']);

			const withoutA = removeItem(withB, 'a');
			expect(withoutA.items.map(item => item.id)).toEqual(['b']);
		});

		it('addGroupChild and removeGroupChild address the group by id', () => {
			const layout = layoutOf([groupItem()]);

			const withChild = addGroupChild(layout, 'g1', { id: 'c2', label: 'New', visible: true, type: 'graphic-item', graphicItem: { type: 'text' } as never, layout: { mode: 'stack', sizing: { mode: 'fixed', size: 100 } } });
			expect(group(withChild).children.map(child => child.id)).toEqual(['c1', 'c2']);

			const withoutFirst = removeGroupChild(withChild, 'g1', 'c1');
			expect(group(withoutFirst).children.map(child => child.id)).toEqual(['c2']);
		});
	});

	describe('anchored geometry', () => {
		it('keeps the anchored edge fixed when resizing an item', () => {
			const layout = layoutOf([graphicItemItem({ anchor: 'top-right' } as never)]);

			const next = patchItemRectFromAnchor(layout, 'w1', 'width', 200);

			// Right edge was at 200; growing to 200 wide moves x to 0.
			expect(next.items[0]).toMatchObject({ width: 200, x: 0 });
		});

		it('moves without resizing for position fields', () => {
			const layout = layoutOf([graphicItemItem()]);

			const next = patchItemRectFromAnchor(layout, 'w1', 'x', 300);

			expect(next.items[0]).toMatchObject({ x: 300, width: 100 });
		});

		it('updates canvas child geometry through its anchor', () => {
			const layout = layoutOf([groupItem({
				arrangement: { mode: 'canvas', padding: 0 },
				children: [
					{ id: 'c1', label: 'Child', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 10, y: 10, width: 100, height: 40 } },
				],
			})]);

			const next = patchGroupChildRectFromAnchor(layout, 'g1', 'c1', 'width', 160);

			expect(group(next).children[0]!.layout).toMatchObject({ width: 160, x: 10 });
		});

		it('is a no-op for stack children', () => {
			const layout = layoutOf([groupItem()]);

			expect(patchGroupChildRectFromAnchor(layout, 'g1', 'c1', 'width', 160)).toBe(layout);
		});
	});

	describe('arrangement conversion', () => {
		it('converts stack children to canvas rects when switching to canvas', () => {
			const layout = layoutOf([groupItem()]);

			const next = convertGroupArrangement(layout, 'g1', 'canvas');

			expect(group(next).arrangement).toEqual({ mode: 'canvas', padding: 10 });
			expect(group(next).children[0]!.layout).toEqual({ mode: 'canvas', x: 0, y: 0, width: 120, height: 80 });
		});

		it('converts canvas children to fixed stack sizing when switching to row', () => {
			const layout = layoutOf([groupItem({
				arrangement: { mode: 'canvas', padding: 4 },
				children: [
					{ id: 'c1', label: 'Child', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 20, y: 10, width: 150, height: 60 } },
				],
			})]);

			const next = convertGroupArrangement(layout, 'g1', 'row');

			expect(group(next).arrangement).toMatchObject({ mode: 'row', padding: 4, gap: 8, align: 'stretch', justify: 'start' });
			expect(group(next).children[0]!.layout).toEqual({ mode: 'stack', sizing: { mode: 'fixed', size: 150 }, offsetX: 0, offsetY: 0 });
		});

		it('leaves children already in the target mode untouched, and non-groups as a no-op', () => {
			const layout = layoutOf([groupItem(), graphicItemItem({ id: 'w9' })]);
			const before = group(layout).children[0];

			const next = convertGroupArrangement(layout, 'g1', 'column');
			expect(group(next).children[0]).toEqual(before);
			expect(group(next).arrangement).toMatchObject({ mode: 'column' });

			expect(convertGroupArrangement(layout, 'w9', 'canvas')).toBe(layout);
		});
	});

	describe('layer ordering', () => {
		function threeItems() {
			return [
				graphicItemItem({ id: 'a' }),
				{
					id: 'media',
					type: 'media',
					label: 'Media',
					visible: true,
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					mediaKind: 'image',
					fit: 'contain',
					focalPosition: { horizontal: 0.5, vertical: 0.5 },
					opacity: 1,
				} as FeatureMatchLayoutItemConfig,
				graphicItemItem({ id: 'b' }),
				graphicItemItem({ id: 'c' }),
			];
		}

		it('sends an item behind every other layer', () => {
			const next = sendItemToBack(layoutOf(threeItems()), 'c');
			expect(next.items.map(item => item.id)).toEqual(['c', 'a', 'media', 'b']);
		});

		it('brings an item in front of every other layer', () => {
			const next = bringItemToFront(layoutOf(threeItems()), 'a');
			expect(next.items.map(item => item.id)).toEqual(['media', 'b', 'c', 'a']);
		});

		it('moves every Graphic Item kind one step in sibling list order', () => {
			const next = moveItemOrder(layoutOf(threeItems()), 'a', 1);
			expect(next.items.map(item => item.id)).toEqual(['media', 'a', 'b', 'c']);

			const movedMedia = moveItemOrder(next, 'media', 1);
			expect(movedMedia.items.map(item => item.id)).toEqual(['a', 'media', 'b', 'c']);
		});

		it('sets an item list position without persisting z-index', () => {
			const next = setItemOrder(layoutOf(threeItems()), 'b', 0);
			expect(next.items.map(item => item.id)).toEqual(['b', 'a', 'media', 'c']);
			expect(next.items.every(item => !('zIndex' in item))).toBe(true);
		});

		it('reorders Graphic Group children by sibling list order', () => {
			const source = layoutOf([groupItem({
				children: [
					{ id: 'a', label: 'A', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 0, y: 0, width: 10, height: 10 } },
					{ id: 'b', label: 'B', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 0, y: 0, width: 10, height: 10 } },
					{ id: 'c', label: 'C', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 0, y: 0, width: 10, height: 10 } },
				],
			})]);

			expect(group(moveGroupChildOrder(source, 'g1', 'a', 1)).children.map(child => child.id))
				.toEqual(['b', 'a', 'c']);
			expect(group(sendGroupChildToBack(source, 'g1', 'c')).children.map(child => child.id))
				.toEqual(['c', 'a', 'b']);
			expect(group(bringGroupChildToFront(source, 'g1', 'a')).children.map(child => child.id))
				.toEqual(['b', 'c', 'a']);
		});
	});

	describe('legacy normalization', () => {
		it('preserves effective legacy stacking while removing z-index and migrating media presentation', () => {
			const legacy = layoutOf([
				graphicItemItem({ id: 'front', zIndex: 30 } as never),
				{
					id: 'media',
					type: 'media',
					label: 'Legacy Media',
					visible: true,
					x: 0,
					y: 0,
					width: 100,
					height: 100,
					mediaKind: 'image',
					fit: 'cover',
					opacity: 1,
					borderRadius: 12,
					surfaceStyle: { backgroundColor: '#fff' },
				} as never,
				graphicItemItem({ id: 'middle', zIndex: 10 } as never),
			]);

			const normalized = normalizeFeatureMatchLayout(legacy);

			expect(normalized.items.map(item => item.id)).toEqual(['media', 'middle', 'front']);
			expect(normalized.items.every(item => !('zIndex' in item))).toBe(true);
			const media = normalized.items[0]!;
			expect(media).toMatchObject({
				type: 'media',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				clipGeometry: {
					topLeft: { kind: 'rounded', size: 12 },
					topRight: { kind: 'rounded', size: 12 },
					bottomRight: { kind: 'rounded', size: 12 },
					bottomLeft: { kind: 'rounded', size: 12 },
				},
			});
			expect(media).not.toHaveProperty('borderRadius');
			expect(media).not.toHaveProperty('surfaceStyle');
		});
	});

	describe('creation', () => {
		it('creates a Source Item with source defaults and returns its id', () => {
			const { layout, id } = createLayoutItem(layoutOf([]), 'source');

			const item = layout.items[0]!;
			expect(item.id).toBe(id);
			expect(item.type).toBe('source');
			expect(item).toMatchObject({ frameCutout: true, sourceRole: 'main' });
		});

		it('creates a GraphicItem Item using the graphicItem definition default config', () => {
			const { layout, id } = createLayoutItem(layoutOf([]), 'life-graphic-item');

			const item = layout.items[0]!;
			expect(item.id).toBe(id);
			expect(item.type).toBe('graphic-item');
			if (item.type === 'graphic-item') {
				expect(item.graphicItem).toMatchObject({ type: 'player-life', playerSide: 'player1' });
				expect(item.label).toBe('Life Graphic Item');
			}
		});

		it('creates a first-class Media Graphic Item without author-editable z-index', () => {
			const { layout } = createLayoutItem(layoutOf([]), 'media');

			expect(layout.items[0]).toMatchObject({
				type: 'media',
				mediaKind: 'image',
				fit: 'contain',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
			});
			expect(layout.items[0]).not.toHaveProperty('zIndex');
			expect(layout.items[0]).not.toHaveProperty('surfaceStyle');
		});

		it('creates a GraphicItem Group child matching the group arrangement mode', () => {
			const { layout, id } = createGroupChild(layoutOf([groupItem()]), 'g1', 'text');

			const child = group(layout).children.at(-1)!;
			expect(child.id).toBe(id);
			expect(child.type !== 'media' ? child.graphicItem.type : undefined).toBe('text');
			expect(child.layout.mode).toBe('stack');
		});

		it('creates a Media Graphic Item child from the shared media defaults', () => {
			const { layout, id } = createGroupChild(layoutOf([groupItem()]), 'g1', 'media' as never);

			const child = group(layout).children.at(-1)!;
			expect(child).toMatchObject({
				id,
				type: 'media',
				label: 'Media Graphic Item',
				mediaKind: 'image',
				fit: 'contain',
				focalPosition: { horizontal: 0.5, vertical: 0.5 },
				opacity: 1,
				videoTarget: 'safari',
			});
			expect(child).not.toHaveProperty('graphic-item');
			expect(child).not.toHaveProperty('surfaceStyle');
			expect(child).not.toHaveProperty('zIndex');
		});

		it('returns a null id and the same layout when creating a child on a non-group item', () => {
			const source = layoutOf([graphicItemItem()]);
			const { layout, id } = createGroupChild(source, 'w1', 'text');

			expect(id).toBeNull();
			expect(layout).toBe(source);
		});
	});
});
