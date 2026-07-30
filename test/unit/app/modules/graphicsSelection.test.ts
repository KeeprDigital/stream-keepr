import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	graphicsSelectionKey,
	isGraphicsSelectionTarget,
	resolveGraphicsSelection,
} from '~/modules/graphics/selection';

const graphics: BroadcastGraphicConfig[] = [
	{
		id: 'lower-third',
		name: 'Lower Third',
		items: [
			{
				type: 'shape',
				id: 'bar',
				label: 'Shape 1',
				visible: true,
				anchor: 'top-left',
				x: 0,
				y: 0,
				width: 100,
				height: 40,
				geometry: { cornerRadius: 0 },
				surfaceStyle: { fill: '#000000', fillOpacity: 1 },
			},
		],
	},
];

describe('graphicsSelection', () => {
	it('resolves a Graphic Item target to its Broadcast Graphic and item', () => {
		const selection = resolveGraphicsSelection(graphics, { type: 'item', graphicId: 'lower-third', itemId: 'bar' });

		expect(selection.kind).toBe('item');
		expect(selection.kind === 'item' && selection.graphic.id).toBe('lower-third');
		expect(selection.kind === 'item' && selection.item.id).toBe('bar');
	});

	it('reports a target whose Broadcast Graphic or Graphic Item no longer exists as missing', () => {
		expect(resolveGraphicsSelection(graphics, { type: 'graphic', graphicId: 'gone' }).kind).toBe('missing');
		expect(resolveGraphicsSelection(graphics, { type: 'item', graphicId: 'lower-third', itemId: 'gone' }).kind).toBe('missing');
	});

	it('keys targets distinctly so surfaces can compare selections', () => {
		expect(graphicsSelectionKey({ type: 'canvas' })).toBe('canvas');
		expect(graphicsSelectionKey({ type: 'graphic', graphicId: 'a' })).toBe('graphic:a');
		expect(graphicsSelectionKey({ type: 'item', graphicId: 'a', itemId: 'b' })).toBe('item:a:b');
	});

	it('guards targets crossing the preview message boundary', () => {
		expect(isGraphicsSelectionTarget({ type: 'canvas' })).toBe(true);
		expect(isGraphicsSelectionTarget({ type: 'item', graphicId: 'a', itemId: 'b' })).toBe(true);
		expect(isGraphicsSelectionTarget({ type: 'item', graphicId: 'a' })).toBe(false);
		expect(isGraphicsSelectionTarget({ type: 'elsewhere' })).toBe(false);
		expect(isGraphicsSelectionTarget(null)).toBe(false);
	});
});
