import type { GraphicGroupItemConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	compositorSelectionTarget,
	editorSelectionExists,
	editorSelectionFrame,
	editorSelectionLabel,
	fromCompositorSelectionTarget,
	fromHostSelectionTarget,
	hostSelectionTarget,
} from '~~/app/modules/feature-match-overlay/editorSelection';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * The Feature Match Overlay editor's one selection, and the two vocabularies it
 * projects into.
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

	it('knows when what it names has left the layout', () => {
		const layout = layoutWith(composition => addGraphicItem(composition, { kind: 'text', id: 'title', ...CANVAS }).graphic);

		expect(editorSelectionExists(layout, { type: 'canvas' })).toBe(true);
		expect(editorSelectionExists(layout, { type: 'item', itemId: 'title' })).toBe(true);
		expect(editorSelectionExists(layout, { type: 'item', itemId: 'gone' })).toBe(false);
		expect(editorSelectionExists(layout, { type: 'source', itemId: 'main-source' })).toBe(true);
		expect(editorSelectionExists(layout, { type: 'source', itemId: 'gone' })).toBe(false);
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

		expect(editorSelectionFrame(layout, { type: 'item', itemId: 'title' }, CANVAS_SIZE)).toMatchObject({
			rect: {
				x: title.x,
				y: title.y,
				width: title.width,
				height: title.height,
			},
			origin: { x: 0, y: 0 },
		});
		expect(editorSelectionFrame(layout, { type: 'source', itemId: 'main-source' }, CANVAS_SIZE)?.rect)
			.toEqual({
				x: source.x,
				y: source.y,
				width: source.width,
				height: source.height,
			});
		expect(editorSelectionFrame(layout, { type: 'canvas' }, CANVAS_SIZE)).toBeNull();
	});

	it('snaps a top-level Graphic Item and a Source Item to each other, since they share the canvas', () => {
		const layout = layoutWith(composition => addGraphicItem(composition, { kind: 'text', id: 'title', ...CANVAS }).graphic);
		const title = layout.composition.items[0]!;
		const source = layout.sources.find(item => item.id === 'main-source')!;

		expect(editorSelectionFrame(layout, { type: 'item', itemId: 'title' }, CANVAS_SIZE)?.snapLines.x)
			.toEqual(expect.arrayContaining([source.x, source.x + source.width]));
		expect(editorSelectionFrame(layout, { type: 'source', itemId: 'main-source' }, CANVAS_SIZE)?.snapLines.y)
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

		expect(editorSelectionFrame(layout, { type: 'item', itemId: 'child' }, CANVAS_SIZE)?.origin).toEqual({ x: 54, y: 64 });
	});

	it('offers a rotated item with its rotation about its anchor, and a Source Item as one that cannot turn', () => {
		const layout = layoutWith(composition => addGraphicItem(composition, { kind: 'text', id: 'title', ...CANVAS }).graphic);
		layout.composition.items = layout.composition.items.map(item => ({ ...item, rotation: 15, anchor: 'center' }) as GraphicItemConfig);
		const title = layout.composition.items[0]!;

		expect(editorSelectionFrame(layout, { type: 'item', itemId: 'title' }, CANVAS_SIZE)).toMatchObject({
			rect: {
				x: title.x,
				y: title.y,
				width: title.width,
				height: title.height,
			},
			rotation: 15,
			anchor: 'center',
		});
		expect(editorSelectionFrame(layout, { type: 'source', itemId: 'main-source' }, CANVAS_SIZE)?.rotation).toBeUndefined();
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
		expect(editorSelectionFrame(layout, { type: 'item', itemId: 'child' }, CANVAS_SIZE)).toBeNull();

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
		expect(editorSelectionFrame(turnedGroup, { type: 'item', itemId: 'child' }, CANVAS_SIZE)).toBeNull();
	});
});
