import type { BroadcastGraphicConfig, GraphicGroupItemConfig } from '~~/shared/types/graphics';
import { describe, expect, it } from 'vitest';
import {
	addGraphicGroupChild,
	addGraphicItem,
	applyShapeGeometryPreset,
	changeGraphicGradientStopCount,
	clearGraphicSurfaceStyle,
	createBroadcastGraphic,
	deleteBroadcastGraphic,
	deleteGraphicItem,
	findGraphicItem,
	flattenGraphicItems,
	GRAPHIC_RULE_PRESET_HEIGHT,
	moveBroadcastGraphic,
	moveGraphicItem,
	patchGraphicGlow,
	patchGraphicGradientAngle,
	patchGraphicGradientStop,
	patchGraphicGroup,
	patchGraphicGroupChildSizing,
	patchGraphicGroupDefaultChildSurfaceStyle,
	patchGraphicItem,
	patchGraphicOutline,
	patchGraphicSolidFill,
	patchGraphicSurfaceStyle,
	patchGraphicTypography,
	patchShapeCorner,
	patchShapeGeometry,
	setGraphicFillKind,
} from '~~/shared/modules/graphics';

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

function graphic(id: string, items: BroadcastGraphicConfig['items'] = []): BroadcastGraphicConfig {
	return { id, name: id, items };
}

/** A Broadcast Graphic holding one Graphic Group with one shape child. */
function withGroup() {
	const built = addGraphicItem(graphic('a'), { kind: 'group', id: 'cluster', ...CANVAS }).graphic;
	return addGraphicGroupChild(built, { kind: 'shape', groupId: 'cluster', id: 'child' }).graphic;
}

function group(built: BroadcastGraphicConfig): GraphicGroupItemConfig {
	const item = built.items.find(entry => entry.id === 'cluster');
	if (item?.type !== 'group')
		throw new Error('expected a Graphic Group');
	return item;
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

	it('keeps sibling Shape Geometry fields when one corner is edited', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

		const patched = patchShapeCorner(
			patchShapeGeometry(built, 'bar', { rightSlant: 40 }),
			'bar',
			'topRight',
			{ treatment: 'cut', size: 24 },
		);

		expect(patched.items[0]).toMatchObject({
			geometry: {
				topRight: { treatment: 'cut', size: 24 },
				topLeft: { treatment: 'square', size: 0 },
				rightSlant: 40,
				leftSlant: 0,
			},
		});
	});

	it('keeps sibling Graphic Surface Style fields when one of them is edited', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

		const patched = patchGraphicSurfaceStyle(built, 'bar', { fillOpacity: 0.4 });

		expect(patched.items[0]).toMatchObject({
			surfaceStyle: { fill: { type: 'solid', color: '#0077a3' }, fillOpacity: 0.4 },
		});
	});

	it('keeps sibling typography fields when one of them is edited', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic;

		const patched = patchGraphicTypography(built, 'name', { fontSize: 96 });

		expect(patched.items[0]).toMatchObject({
			typography: { fontSize: 96, fontWeight: 700, textAlign: 'left', color: '#ffffff' },
		});
	});

	it('ignores a property-group edit aimed at the wrong Graphic Item kind', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic;

		expect(patchShapeGeometry(built, 'name', { leftSlant: 12 })).toEqual(built);
		expect(patchGraphicTypography(built, 'missing', { fontSize: 96 })).toEqual(built);
		expect(patchGraphicGroup(built, 'name', { padding: 8 })).toEqual(built);
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

	describe('graphic fill', () => {
		it('switches a Graphic Fill between solid and gradient without losing the authored colour', () => {
			const built = patchGraphicSolidFill(
				addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic,
				'bar',
				'#123456',
			);

			const gradient = setGraphicFillKind(built, 'bar', 'linear-gradient');
			const back = setGraphicFillKind(gradient, 'bar', 'solid');

			expect(gradient.items[0]).toMatchObject({
				surfaceStyle: {
					fill: {
						type: 'linear-gradient',
						angle: 90,
						stops: [{ color: '#123456', position: 0 }, { color: '#000000', position: 1 }],
					},
				},
			});
			expect(back.items[0]).toMatchObject({ surfaceStyle: { fill: { type: 'solid', color: '#123456' } } });
		});

		it('edits one gradient stop and the angle without disturbing the others', () => {
			const built = setGraphicFillKind(
				addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic,
				'bar',
				'linear-gradient',
			);

			const patched = patchGraphicGradientStop(
				patchGraphicGradientAngle(built, 'bar', 135),
				'bar',
				1,
				{ opacity: 0.4 },
			);

			expect(patched.items[0]?.surfaceStyle?.fill).toMatchObject({
				angle: 135,
				stops: [
					{ color: '#0077a3', position: 0, opacity: 1 },
					{ color: '#000000', position: 1, opacity: 0.4 },
				],
			});
		});

		it('holds a Graphic Fill between two and four stops', () => {
			const built = setGraphicFillKind(
				addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic,
				'bar',
				'linear-gradient',
			);

			let grown = built;
			for (let index = 0; index < 5; index += 1)
				grown = changeGraphicGradientStopCount(grown, 'bar', 1);

			let shrunk = grown;
			for (let index = 0; index < 5; index += 1)
				shrunk = changeGraphicGradientStopCount(shrunk, 'bar', -1);

			expect(grown.items[0]?.surfaceStyle?.fill.type === 'linear-gradient'
				&& grown.items[0]?.surfaceStyle?.fill.stops).toHaveLength(4);
			expect(shrunk.items[0]?.surfaceStyle?.fill.type === 'linear-gradient'
				&& shrunk.items[0]?.surfaceStyle?.fill.stops).toHaveLength(2);
		});

		it('adds and removes an outline and a glow without touching the fill', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			const styled = patchGraphicGlow(
				patchGraphicOutline(built, 'bar', { width: 6 }),
				'bar',
				{ color: '#ff51c7' },
			);
			const stripped = patchGraphicGlow(patchGraphicOutline(styled, 'bar', null), 'bar', null);

			expect(styled.items[0]?.surfaceStyle).toMatchObject({
				fill: { type: 'solid', color: '#0077a3' },
				outline: { color: '#ffffff', width: 6 },
				glow: { color: '#ff51c7', size: 24, opacity: 0.8 },
			});
			expect(stripped.items[0]?.surfaceStyle?.outline).toBeUndefined();
			expect(stripped.items[0]?.surfaceStyle?.glow).toBeUndefined();
			expect(stripped.items[0]?.surfaceStyle?.fill).toEqual({ type: 'solid', color: '#0077a3' });
		});

		it('gives a Text Graphic Item a Graphic Surface Style, and takes it away again', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'text', id: 'name', ...CANVAS }).graphic;

			const styled = patchGraphicSurfaceStyle(built, 'name', { fillOpacity: 0.75 });
			const cleared = clearGraphicSurfaceStyle(styled, 'name');

			expect(built.items[0]?.surfaceStyle).toBeUndefined();
			expect(styled.items[0]?.surfaceStyle).toEqual({
				fill: { type: 'solid', color: '#0077a3' },
				fillOpacity: 0.75,
			});
			expect(cleared.items[0]?.surfaceStyle).toBeUndefined();
		});
	});

	describe('shape geometry presets', () => {
		it('initialises a Shape Geometry from a preset, and a rule also proposes a height', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			const cut = applyShapeGeometryPreset(built, 'bar', 'corner-cut');
			const rule = applyShapeGeometryPreset(built, 'bar', 'rule');

			expect(cut.items[0]).toMatchObject({
				geometry: { topRight: { treatment: 'cut' }, bottomLeft: { treatment: 'cut' } },
				height: built.items[0]?.height,
			});
			expect(rule.items[0]?.height).toBe(GRAPHIC_RULE_PRESET_HEIGHT);
		});

		it('applies a preset to the Shape Geometry a Graphic Group owns too', () => {
			const built = withGroup();

			const patched = applyShapeGeometryPreset(built, 'cluster', 'slanted-edge');

			expect(group(patched).geometry.rightSlant).toBeGreaterThan(0);
		});
	});

	it('refuses main-axis sizing on a top-level Graphic Item, which no group sizes', () => {
		const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

		// The wire schema rejects sizing on a top-level item, so authoring one would
		// build a config no write would accept.
		expect(patchGraphicGroupChildSizing(built, 'bar', { mode: 'fill' })).toEqual(built);
	});

	describe('graphic groups', () => {
		it('adds a child to a Graphic Group in its own Graphic Layer Order', () => {
			const built = addGraphicGroupChild(withGroup(), {
				kind: 'text',
				groupId: 'cluster',
				id: 'name',
				...CANVAS,
			}).graphic;

			expect(group(built).children.map(child => child.id)).toEqual(['child', 'name']);
			expect(built.items).toHaveLength(1);
		});

		it('sizes a new child against its Graphic Group rather than the Screen canvas', () => {
			const built = patchGraphicItem(withGroup(), 'cluster', { width: 500, height: 200 });

			const added = addGraphicGroupChild(built, { kind: 'shape', groupId: 'cluster', id: 'inner' }).graphic;
			const child = group(added).children.find(entry => entry.id === 'inner');

			expect(child).toMatchObject({ width: 200, height: 20 });
		});

		it('names a new child distinctly from every existing item, at any depth', () => {
			const built = addGraphicGroupChild(withGroup(), {
				kind: 'shape',
				groupId: 'cluster',
				id: 'second',
				...CANVAS,
			}).graphic;

			expect(group(built).children.map(child => child.label)).toEqual(['Shape 1', 'Shape 2']);
		});

		it('refuses to add a child to something that is not a Graphic Group', () => {
			const built = addGraphicItem(graphic('a'), { kind: 'shape', id: 'bar', ...CANVAS }).graphic;

			expect(addGraphicGroupChild(built, { kind: 'text', groupId: 'bar', id: 'x' }).graphic).toEqual(built);
		});

		it('finds and flattens a Graphic Group child by id alone', () => {
			const built = withGroup();

			expect(findGraphicItem(built, 'child')).toMatchObject({
				item: { id: 'child' },
				group: { id: 'cluster' },
			});
			expect(findGraphicItem(built, 'cluster')?.group).toBeUndefined();
			expect(findGraphicItem(built, 'nowhere')).toBeNull();
			expect(flattenGraphicItems(built).map(item => item.id)).toEqual(['cluster', 'child']);
		});

		it('reorders and deletes inside the group the child belongs to', () => {
			const built = addGraphicGroupChild(withGroup(), {
				kind: 'text',
				groupId: 'cluster',
				id: 'name',
				...CANVAS,
			}).graphic;

			expect(group(moveGraphicItem(built, 'child', 1)).children.map(child => child.id)).toEqual(['name', 'child']);
			expect(group(deleteGraphicItem(built, 'child')).children.map(child => child.id)).toEqual(['name']);
			// Deleting the group takes its children with it.
			expect(deleteGraphicItem(built, 'cluster').items).toEqual([]);
		});

		it('patches a Graphic Group child through the same helpers as a top-level item', () => {
			const built = withGroup();

			const patched = patchGraphicSurfaceStyle(
				patchShapeCorner(built, 'child', 'topLeft', { treatment: 'rounded', size: 8 }),
				'child',
				{ fillOpacity: 0.2 },
			);
			const child = group(patched).children[0];

			expect(child).toMatchObject({
				geometry: { topLeft: { treatment: 'rounded', size: 8 } },
				surfaceStyle: { fillOpacity: 0.2 },
			});
		});

		it('lets a child inherit or override the local style default of its Graphic Group', () => {
			const built = patchGraphicGroupDefaultChildSurfaceStyle(withGroup(), 'cluster', { fillOpacity: 0.3 });

			const inheriting = clearGraphicSurfaceStyle(built, 'child');
			const overriding = patchGraphicSurfaceStyle(inheriting, 'child', { fillOpacity: 1 });
			const removed = patchGraphicGroupDefaultChildSurfaceStyle(built, 'cluster', null);

			expect(group(built).defaultChildSurfaceStyle).toMatchObject({ fillOpacity: 0.3 });
			expect(group(inheriting).children[0]?.surfaceStyle).toBeUndefined();
			expect(group(overriding).children[0]?.surfaceStyle).toMatchObject({ fillOpacity: 1 });
			expect(group(removed).defaultChildSurfaceStyle).toBeUndefined();
		});

		it('merges the main-axis sizing of a child without dropping its siblings', () => {
			const built = patchGraphicGroupChildSizing(withGroup(), 'child', { mode: 'fill' });

			const patched = patchGraphicGroupChildSizing(built, 'child', { weight: 3 });

			expect(group(patched).children[0]?.sizing).toEqual({
				mode: 'fill',
				size: group(built).children[0]!.width,
				weight: 3,
			});
		});

		it('patches the arrangement of a Graphic Group without touching its children', () => {
			const built = withGroup();

			const patched = patchGraphicGroup(built, 'cluster', { arrangement: 'canvas', clip: true });

			expect(group(patched)).toMatchObject({ arrangement: 'canvas', clip: true });
			expect(group(patched).children).toEqual(group(built).children);
		});
	});
});
