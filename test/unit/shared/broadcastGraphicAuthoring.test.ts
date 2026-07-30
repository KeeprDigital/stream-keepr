import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	addGraphicItem,
	createBroadcastGraphic,
	deleteBroadcastGraphic,
	deleteGraphicItem,
	moveBroadcastGraphic,
	moveGraphicItem,
	patchGraphicItem,
} from '~~/shared/modules/graphics';

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

function graphic(id: string, items: BroadcastGraphicConfig['items'] = []): BroadcastGraphicConfig {
	return { id, name: id, items };
}

describe('broadcastGraphicAuthoring', () => {
	it('adds a Broadcast Graphic to the front of the Screen stack without mutating the stack', () => {
		const stack = [graphic('a')];

		const { graphics, graphicId } = createBroadcastGraphic(stack, { id: 'b' });

		expect(graphics.map(entry => entry.id)).toEqual(['a', 'b']);
		expect(graphicId).toBe('b');
		expect(stack).toHaveLength(1);
	});

	it('names each new Broadcast Graphic distinctly', () => {
		const first = createBroadcastGraphic([], { id: 'a' });
		const second = createBroadcastGraphic(first.graphics, { id: 'b' });

		expect(first.graphics[0]?.name).toBe('Graphic 1');
		expect(second.graphics[1]?.name).toBe('Graphic 2');
	});

	it('reorders a Broadcast Graphic within the authored back-to-front stack', () => {
		const stack = [graphic('a'), graphic('b'), graphic('c')];

		expect(moveBroadcastGraphic(stack, 'a', 1).map(entry => entry.id)).toEqual(['b', 'a', 'c']);
		expect(moveBroadcastGraphic(stack, 'c', -1).map(entry => entry.id)).toEqual(['a', 'c', 'b']);
	});

	it('leaves the stack order alone when a move would run off either end', () => {
		const stack = [graphic('a'), graphic('b')];

		expect(moveBroadcastGraphic(stack, 'a', -1).map(entry => entry.id)).toEqual(['a', 'b']);
		expect(moveBroadcastGraphic(stack, 'b', 1).map(entry => entry.id)).toEqual(['a', 'b']);
	});

	it('deletes one Broadcast Graphic and keeps the rest in order', () => {
		const stack = [graphic('a'), graphic('b'), graphic('c')];

		expect(deleteBroadcastGraphic(stack, 'b').map(entry => entry.id)).toEqual(['a', 'c']);
	});

	it('places a Graphic Item at the front of the Graphic Layer Order', () => {
		const { graphic: updated, itemId } = addGraphicItem(graphic('a'), {
			kind: 'shape',
			id: 'item-1',
			...CANVAS,
		});
		const { graphic: withText } = addGraphicItem(updated, { kind: 'text', id: 'item-2', ...CANVAS });

		expect(itemId).toBe('item-1');
		expect(withText.items.map(item => item.type)).toEqual(['shape', 'text']);
		expect(withText.items.map(item => item.label)).toEqual(['Shape 1', 'Text 1']);
	});

	it('reorders and deletes Graphic Items within one Broadcast Graphic', () => {
		const built = addGraphicItem(
			addGraphicItem(graphic('a'), { kind: 'shape', id: 'back', ...CANVAS }).graphic,
			{ kind: 'text', id: 'front', ...CANVAS },
		).graphic;

		expect(moveGraphicItem(built, 'back', 1).items.map(item => item.id)).toEqual(['front', 'back']);
		expect(deleteGraphicItem(built, 'back').items.map(item => item.id)).toEqual(['front']);
	});

	it('patches one Graphic Item and leaves its siblings untouched', () => {
		const built = addGraphicItem(
			addGraphicItem(graphic('a'), { kind: 'text', id: 'headline', ...CANVAS }).graphic,
			{ kind: 'shape', id: 'bar', ...CANVAS },
		).graphic;

		const patched = patchGraphicItem(built, 'headline', { label: 'Headline', x: 40 });

		expect(patched.items[0]).toMatchObject({ id: 'headline', label: 'Headline', x: 40 });
		expect(patched.items[1]).toEqual(built.items[1]);
		expect(built.items[0]?.label).toBe('Text 1');
	});
});
