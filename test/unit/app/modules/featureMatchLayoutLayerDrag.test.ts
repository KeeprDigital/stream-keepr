import type { FeatureMatchLayoutEditorLayer } from '~~/app/modules/feature-match-overlay/editorSelection';
import type { LayerDrop } from '~~/app/modules/feature-match-overlay/layerDrag';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { dropLayer, layerDropAt, layerGroupMoves } from '~~/app/modules/feature-match-overlay/layerDrag';
import { layerOrder } from '~~/app/modules/feature-match-overlay/layerSelection';
import { addGraphicGroupChild, addGraphicItem, findGraphicItem, patchGraphicItem } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * Dragging one row of the layer list (#741): where the pointer over a row drops
 * it, and what that drop does to the layout.
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

/** Front to back: empty group `e`; group `a` (`a1`, `a2`); group `b` (`b1`); item `top`; then Sources `s2`, `s1`. */
function layout(options: { topRotation?: number } = {}): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	let composition: BroadcastGraphicConfig = { ...base.composition, items: [] };
	composition = addGraphicItem(composition, { kind: 'text', id: 'top', ...CANVAS }).graphic;
	composition = addGraphicItem(composition, { kind: 'group', id: 'b', ...CANVAS }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'b', id: 'b1' }).graphic;
	composition = addGraphicItem(composition, { kind: 'group', id: 'a', ...CANVAS }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'a', id: 'a2' }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'a', id: 'a1' }).graphic;
	composition = addGraphicItem(composition, { kind: 'group', id: 'e', ...CANVAS }).graphic;
	composition = patchGraphicItem(composition, 'top', { rotation: options.topRotation });
	const source = base.sources[0]!;
	return {
		...base,
		composition,
		sources: [
			{ ...source, id: 's1' },
			{ ...source, id: 's2' },
		],
	};
}

const LAYOUT = layout();

function layer(id: string): FeatureMatchLayoutEditorLayer {
	return id.startsWith('s')
		? { type: 'source', itemId: id }
		: { type: 'item', itemId: id };
}

function order(next: FeatureMatchLayoutConfig) {
	return layerOrder(next).map(entry => entry.itemId);
}

function parentOf(next: FeatureMatchLayoutConfig, id: string) {
	return findGraphicItem(next.composition, id)?.group?.id ?? null;
}

describe('feature match layout layer drag', () => {
	// The row's upper part puts it in front, the lower part behind; a group's lower part takes it in.
	it.each<[string, string, string, number, Pick<LayerDrop, 'row' | 'edge' | 'place'> | null]>([
		[
			'a row\'s upper half puts it in front',
			'top',
			'b',
			0.2,
			{
				row: 'item:b',
				edge: 'top',
				place: {
					kind: 'in-front-of',
					of: layer('b'),
				},
			},
		],
		[
			'a group\'s lower part takes it in',
			'top',
			'a',
			0.6,
			{
				row: 'item:a',
				edge: 'inside',
				place: { kind: 'into', groupId: 'a' },
			},
		],
		[
			'an empty group\'s lowest third puts it behind',
			'top',
			'e',
			0.9,
			{
				row: 'item:e',
				edge: 'bottom',
				place: {
					kind: 'behind',
					of: layer('e'),
				},
			},
		],
		[
			'a child\'s upper half puts it in front of the child',
			'top',
			'a1',
			0.2,
			{
				row: 'item:a1',
				edge: 'top',
				place: {
					kind: 'in-front-of',
					of: layer('a1'),
				},
			},
		],
		[
			'a child\'s lower half puts it behind the child',
			'top',
			'a1',
			0.6,
			{
				row: 'item:a1',
				edge: 'bottom',
				place: {
					kind: 'behind',
					of: layer('a1'),
				},
			},
		],
		[
			'the last child\'s lowest quarter puts it behind the group',
			'a1',
			'a2',
			0.9,
			{
				row: 'item:a2',
				edge: 'below-group',
				place: {
					kind: 'behind',
					of: layer('a'),
				},
			},
		],
		[
			'a group over a child goes nowhere',
			'b',
			'a1',
			0.3,
			null,
		],
		[
			'a group over a group with children goes in front of it',
			'b',
			'a',
			0.8,
			{
				row: 'item:a',
				edge: 'top',
				place: {
					kind: 'in-front-of',
					of: layer('a'),
				},
			},
		],
		[
			'a group over its own child goes nowhere',
			'a',
			'a2',
			0.9,
			null,
		],
		[
			'a row over itself goes nowhere',
			'top',
			'top',
			0.2,
			null,
		],
		[
			'a Source over a Source',
			's1',
			's2',
			0.3,
			{
				row: 'source:s2',
				edge: 'top',
				place: {
					kind: 'in-front-of',
					of: layer('s2'),
				},
			},
		],
		[
			'a Source over a Graphic Item goes nowhere',
			's1',
			'top',
			0.3,
			null,
		],
		[
			'a Graphic Item over a Source goes nowhere',
			'top',
			's1',
			0.3,
			null,
		],
	])('%s', (_case, dragged, over, fraction, expected) => {
		const drop = layerDropAt(LAYOUT, layer(dragged), layer(over), fraction);

		if (expected)
			expect(drop).toMatchObject({ ...expected, refusal: null });
		else
			expect(drop).toBeNull();
	});

	it.each<[string, string, LayerDrop['place'], string[], Record<string, string | null>]>([
		[
			'into a group, at its front',
			'top',
			{ kind: 'into', groupId: 'a' },
			['e', 'a', 'top', 'a1', 'a2', 'b', 'b1'],
			{ top: 'a' },
		],
		[
			'in front of a top-level row',
			'top',
			{
				kind: 'in-front-of',
				of: layer('b'),
			},
			['e', 'a', 'a1', 'a2', 'top', 'b', 'b1'],
			{ top: null },
		],
		[
			'out behind its group',
			'a1',
			{
				kind: 'behind',
				of: layer('a'),
			},
			['e', 'a', 'a2', 'a1', 'b', 'b1', 'top'],
			{ a1: null },
		],
		[
			'into another group behind a child',
			'a1',
			{
				kind: 'behind',
				of: layer('b1'),
			},
			['e', 'a', 'a2', 'b', 'b1', 'a1', 'top'],
			{ a1: 'b' },
		],
		[
			'a Source behind a Source',
			's2',
			{
				kind: 'behind',
				of: layer('s1'),
			},
			['e', 'a', 'a1', 'a2', 'b', 'b1', 'top'],
			{},
		],
	])('drops a row %s', (_case, dragged, place, items, parents) => {
		const next = dropLayer(LAYOUT, layer(dragged), place);

		expect(order(next).filter(id => !id.startsWith('s'))).toEqual(items);
		for (const [id, parent] of Object.entries(parents))
			expect(parentOf(next, id)).toBe(parent);
		if (dragged === 's2')
			expect(next.sources.map(source => source.id)).toEqual(['s2', 's1']);
	});

	// E14: shown as refused while hovered, and the drop changes nothing.
	it('refuses a rotated item into a row group, with its reason, and drops nothing', () => {
		const rotated = layout({ topRotation: 15 });

		expect(layerDropAt(rotated, layer('top'), layer('a'), 0.6)).toMatchObject({ edge: 'inside', refusal: 'rotated-into-arranged-group' });
		expect(layerDropAt(rotated, layer('top'), layer('a1'), 0.2)).toMatchObject({ refusal: 'rotated-into-arranged-group' });
		expect(dropLayer(rotated, layer('top'), { kind: 'into', groupId: 'a' })).toBe(rotated);
	});

	it('answers the same layout for a drop that changes nothing', () => {
		expect(dropLayer(LAYOUT, layer('top'), {
			kind: 'behind',
			of: layer('b'),
		})).toBe(LAYOUT);
		expect(dropLayer(LAYOUT, layer('s1'), {
			kind: 'behind',
			of: layer('s2'),
		})).toBe(LAYOUT);
	});

	// E15: the keyboard alternative to dragging a row into or out of a group.
	it('offers a Graphic Item every other group to move into, and out of its own in front of it', () => {
		const rotated = layout({ topRotation: 15 });

		// Groups are labelled in the order they were added: `b`, `a`, then `e`.
		expect(layerGroupMoves(LAYOUT, layer('a1'))).toEqual([
			{
				label: 'Out of Group 2',
				place: {
					kind: 'in-front-of',
					of: layer('a'),
				},
				refusal: null,
			},
			{
				label: 'Group 3',
				place: { kind: 'into', groupId: 'e' },
				refusal: null,
			},
			{
				label: 'Group 1',
				place: { kind: 'into', groupId: 'b' },
				refusal: null,
			},
		]);
		expect(layerGroupMoves(rotated, layer('top')).map(move => [move.label, move.refusal])).toEqual([
			['Group 3', 'rotated-into-arranged-group'],
			['Group 2', 'rotated-into-arranged-group'],
			['Group 1', 'rotated-into-arranged-group'],
		]);
		expect(layerGroupMoves(LAYOUT, layer('a'))).toEqual([]);
		expect(layerGroupMoves(LAYOUT, layer('s1'))).toEqual([]);
	});
});
