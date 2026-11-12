import type { GraphicGroupItemConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_LAYOUT_EDITOR_TREE } from '~~/app/modules/feature-match-overlay/editorHost';
import {
	compositorSelectionTarget,
	editorSelectionLabel,
	fromCompositorSelectionTarget,
	fromHostSelectionTarget,
	hostSelectionTarget,
} from '~~/app/modules/feature-match-overlay/editorSelection';
import { editorLayersFrame, editorSelectionFrame } from '~~/app/modules/graphics/editor/layerFrame';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * The Feature Match Overlay editor's one selection and the two vocabularies it
 * projects into, and where the shared editor frames its layers on the canvas.
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };
const CANVAS_SIZE = { width: 1920, height: 1080 };

function layoutWith(items: (composition: FeatureMatchLayoutConfig['composition']) => FeatureMatchLayoutConfig['composition']): FeatureMatchLayoutConfig {
	const layout = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	return {
		...layout,
		composition: items({ ...layout.composition, items: [] }),
	};
}

function group(layout: FeatureMatchLayoutConfig): GraphicGroupItemConfig {
	return layout.composition.items.find(item => item.type === 'group') as GraphicGroupItemConfig;
}

describe('feature match layout editor selection', () => {
	it('projects a Source Item into the host vocabulary and the canvas into the compositor one', () => {
		const selection = { type: 'source', itemId: 'main-source' } as const;

		expect(hostSelectionTarget(selection)).toEqual({ type: 'source', itemId: 'main-source' });
		expect(compositorSelectionTarget(selection)).toEqual({ type: 'canvas' });
	});

	it('projects a Graphic Item into the compositor vocabulary and the canvas into the host one', () => {
		const selection = { type: 'item', itemId: 'clock' } as const;

		expect(compositorSelectionTarget(selection)).toEqual({ type: 'item', graphicId: 'feature-match-layout', itemId: 'clock' });
		expect(hostSelectionTarget(selection)).toEqual({ type: 'canvas' });
	});

	it('reads either vocabulary back, a whole-composition target as the canvas', () => {
		expect(fromHostSelectionTarget({ type: 'source', itemId: 's' })).toEqual({ type: 'source', itemId: 's' });
		expect(fromCompositorSelectionTarget({ type: 'item', graphicId: 'feature-match-layout', itemId: 'i' })).toEqual({ type: 'item', itemId: 'i' });
		expect(fromCompositorSelectionTarget({ type: 'graphic', graphicId: 'feature-match-layout' })).toEqual({ type: 'canvas' });
	});

	it('names the layer it selects, a group child included, and nothing for the canvas or a layer that has gone', () => {
		const layout = layoutWith(composition => addGraphicGroupChild(
			addGraphicItem(composition, { kind: 'group', id: 'cluster', ...CANVAS }).graphic,
			{ kind: 'shape', groupId: 'cluster', id: 'child' },
		).graphic);
		const child = group(layout).children[0]!;
		const source = layout.sources.find(item => item.id === 'main-source')!;

		expect(editorSelectionLabel(layout, { type: 'item', itemId: 'child' })).toBe(child.label);
		expect(editorSelectionLabel(layout, { type: 'source', itemId: 'main-source' })).toBe(source.label);
		expect(editorSelectionLabel(layout, { type: 'item', itemId: 'gone' })).toBeUndefined();
		expect(editorSelectionLabel(layout, { type: 'canvas' })).toBeUndefined();
	});

	it('places a Source Item and a top-level Graphic Item on the canvas itself', () => {
		const layout = layoutWith(composition => addGraphicItem(composition, { kind: 'text', id: 'title', ...CANVAS }).graphic);
		const title = layout.composition.items[0]!;
		const source = layout.sources.find(item => item.id === 'main-source')!;

		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'item', itemId: 'title' }, CANVAS_SIZE)).toMatchObject({
			rect: {
				x: title.x,
				y: title.y,
				width: title.width,
				height: title.height,
			},
			origin: { x: 0, y: 0 },
		});
		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'source', itemId: 'main-source' }, CANVAS_SIZE)?.rect)
			.toEqual({
				x: source.x,
				y: source.y,
				width: source.width,
				height: source.height,
			});
		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'canvas' }, CANVAS_SIZE)).toBeNull();
	});

	it('snaps a top-level Graphic Item and a Source Item to each other, since they share the canvas', () => {
		const layout = layoutWith(composition => addGraphicItem(composition, { kind: 'text', id: 'title', ...CANVAS }).graphic);
		const title = layout.composition.items[0]!;
		const source = layout.sources.find(item => item.id === 'main-source')!;

		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'item', itemId: 'title' }, CANVAS_SIZE)?.snapLines.x)
			.toEqual(expect.arrayContaining([source.x, source.x + source.width]));
		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'source', itemId: 'main-source' }, CANVAS_SIZE)?.snapLines.y)
			.toEqual(expect.arrayContaining([title.y, title.y + title.height]));
	});

	it('places a canvas-arranged group child inside its group\'s padded box', () => {
		let layout = layoutWith(composition => addGraphicGroupChild(
			addGraphicItem(composition, { kind: 'group', id: 'cluster', ...CANVAS }).graphic,
			{ kind: 'shape', groupId: 'cluster', id: 'child' },
		).graphic);
		const cluster = {
			...group(layout),
			arrangement: 'canvas' as const,
			padding: 4,
			x: 50,
			y: 60,
		};
		layout = {
			...layout,
			composition: {
				...layout.composition,
				items: [cluster],
			},
		};

		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'item', itemId: 'child' }, CANVAS_SIZE)?.origin).toEqual({ x: 54, y: 64 });
	});

	it('offers a rotated item with its rotation about its anchor, and a Source Item as one that cannot turn', () => {
		const layout = layoutWith(composition => addGraphicItem(composition, { kind: 'text', id: 'title', ...CANVAS }).graphic);
		layout.composition.items = layout.composition.items.map(item => ({ ...item, rotation: 15, anchor: 'center' }) as GraphicItemConfig);
		const title = layout.composition.items[0]!;

		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'item', itemId: 'title' }, CANVAS_SIZE)).toMatchObject({
			rect: {
				x: title.x,
				y: title.y,
				width: title.width,
				height: title.height,
			},
			rotation: 15,
			anchor: 'center',
		});
		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'source', itemId: 'main-source' }, CANVAS_SIZE)?.rotation).toBeUndefined();
	});

	it('offers nothing to move for a row child or a rotated group\'s child', () => {
		let layout = layoutWith(composition => addGraphicGroupChild(
			addGraphicItem(composition, { kind: 'group', id: 'cluster', ...CANVAS }).graphic,
			{ kind: 'shape', groupId: 'cluster', id: 'child' },
		).graphic);
		layout = {
			...layout,
			composition: {
				...layout.composition,
				items: [
					{
						...group(layout),
						arrangement: 'row',
					},
				],
			},
		};
		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'item', itemId: 'child' }, CANVAS_SIZE)).toBeNull();

		const turnedGroup = {
			...layout,
			composition: {
				...layout.composition,
				items: [
					{
						...group(layout),
						arrangement: 'canvas' as const,
						rotation: 30,
					},
				],
			},
		};
		expect(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, turnedGroup, { type: 'item', itemId: 'child' }, CANVAS_SIZE)).toBeNull();
	});

	describe('several layers (#740)', () => {
		/** A canvas-arranged `cluster` at (50, 60) padded 4, its `child` at (10, 20); `title` at (500, 400); the main Source Item. */
		function layoutOfThree(): FeatureMatchLayoutConfig {
			const layout = layoutWith(composition => addGraphicGroupChild(
				addGraphicItem(addGraphicItem(composition, { kind: 'text', id: 'title', ...CANVAS }).graphic, { kind: 'group', id: 'cluster', ...CANVAS }).graphic,
				{ kind: 'shape', groupId: 'cluster', id: 'child' },
			).graphic);
			return {
				...layout,
				sources: layout.sources.map(source => source.id === 'main-source'
					? {
							...source,
							x: 100,
							y: 100,
							width: 200,
							height: 100,
						}
					: source),
				composition: {
					...layout.composition,
					items: layout.composition.items.map((item) => {
						if (item.type === 'group') {
							return {
								...item,
								arrangement: 'canvas' as const,
								padding: 4,
								x: 50,
								y: 60,
								children: item.children.map(child => ({
									...child,
									x: 10,
									y: 20,
									width: 30,
									height: 40,
								})),
							};
						}
						return {
							...item,
							x: 500,
							y: 400,
							width: 100,
							height: 50,
						} as GraphicItemConfig;
					}),
				},
			};
		}

		it('moves them as the box they cover on the canvas, a group child placed in its group', () => {
			const frame = editorLayersFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layoutOfThree(), [
				{ type: 'item', itemId: 'child' },
				{ type: 'item', itemId: 'title' },
				{ type: 'source', itemId: 'main-source' },
			], CANVAS_SIZE);

			expect(frame).toMatchObject({
				rect: {
					x: 64,
					y: 84,
					width: 536,
					height: 366,
				},
				origin: { x: 0, y: 0 },
				members: [
					{ x: 64, y: 84, width: 30, height: 40 },
					{
						x: 500,
						y: 400,
						width: 100,
						height: 50,
					},
					{
						x: 100,
						y: 100,
						width: 200,
						height: 100,
					},
				],
			});
			expect(frame?.snapLines.x).not.toContain(600);
		});

		it('frames one layer as that layer alone, and none as nothing', () => {
			const layout = layoutOfThree();

			expect(editorLayersFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, [
				{ type: 'item', itemId: 'child' },
			], CANVAS_SIZE))
				.toEqual(editorSelectionFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, { type: 'item', itemId: 'child' }, CANVAS_SIZE));
			expect(editorLayersFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout, [], CANVAS_SIZE)).toBeNull();
		});

		it('offers nothing to move when the canvas cannot move one of them', () => {
			const layout = layoutOfThree();
			const rowCluster = {
				...layout,
				composition: {
					...layout.composition,
					items: layout.composition.items.map(item => item.type === 'group'
						? { ...item, arrangement: 'row' as const }
						: item),
				},
			};

			expect(editorLayersFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, rowCluster, [
				{ type: 'item', itemId: 'child' },
				{ type: 'item', itemId: 'title' },
			], CANVAS_SIZE)).toBeNull();
		});

		it('moves a rotated layer among them by the box it turns into', () => {
			const layout = layoutOfThree();
			const turned = {
				...layout,
				composition: {
					...layout.composition,
					items: layout.composition.items.map(item => item.id === 'title'
						? { ...item, rotation: 90, anchor: 'center' } as GraphicItemConfig
						: item),
				},
			};

			expect(editorLayersFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, turned, [
				{ type: 'item', itemId: 'title' },
				{ type: 'source', itemId: 'main-source' },
			], CANVAS_SIZE)?.members).toEqual([
				{
					x: 525,
					y: 375,
					width: 50,
					height: 100,
				},
				{
					x: 100,
					y: 100,
					width: 200,
					height: 100,
				},
			]);
		});

		describe('with Layer Locks (#747)', () => {
			const TITLE = { type: 'item', itemId: 'title' } as const;
			const CHILD = { type: 'item', itemId: 'child' } as const;
			const SOURCE = { type: 'source', itemId: 'main-source' } as const;

			function lockedOnly(...keys: string[]) {
				return (layer: { type: string; itemId: string }) => keys.includes(`${layer.type}:${layer.itemId}`);
			}

			it.each([
				[
					'one locked layer',
					[TITLE],
				],
				[
					'several, every one locked',
					[TITLE, SOURCE],
				],
			])('offers nothing to move for %s', (_, layers) => {
				expect(editorLayersFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layoutOfThree(), layers, CANVAS_SIZE, lockedOnly('item:title', 'source:main-source'))).toBeNull();
			});

			it('moves only the unlocked ones, leaving a locked one where it is to snap to', () => {
				const frame = editorLayersFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layoutOfThree(), [CHILD, TITLE, SOURCE], CANVAS_SIZE, lockedOnly('item:title'));

				expect(frame).toMatchObject({
					rect: {
						x: 64,
						y: 84,
						width: 236,
						height: 116,
					},
					members: [
						{ x: 64, y: 84, width: 30, height: 40 },
						{
							x: 100,
							y: 100,
							width: 200,
							height: 100,
						},
					],
				});
				expect(frame?.snapLines.x).toContain(600);
				expect(frame?.snapLines.x).not.toContain(300);
			});

			it('still only moves one unlocked layer selected among locked ones, offering no resize', () => {
				expect(editorLayersFrame(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layoutOfThree(), [TITLE, SOURCE], CANVAS_SIZE, lockedOnly('item:title'))?.members)
					.toEqual([
						{
							x: 100,
							y: 100,
							width: 200,
							height: 100,
						},
					]);
			});
		});
	});
});
