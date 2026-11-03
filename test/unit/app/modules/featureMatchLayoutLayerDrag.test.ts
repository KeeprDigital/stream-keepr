import type { FeatureMatchLayoutEditorLayer } from '~~/app/modules/feature-match-overlay/editorSelection';
import type { LayerDrop, LayerPlace } from '~~/app/modules/feature-match-overlay/layerDrag';
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

/** Front to back: empty group `e`; group `a` (`a1`, `a2`); group `b` (`b1`); item `top`; then Source Items `s2`, `s1`. */
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
			'a Source Item over a Source Item',
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
			'a Source Item over a Graphic Item goes nowhere',
			's1',
			'top',
			0.3,
			null,
		],
		[
			'a Graphic Item over a Source Item goes nowhere',
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

	const SOURCE_ITEMS = ['s1', 's2'];

	it.each<[string, string, LayerPlace, string[], string[], Record<string, string | null>]>([
		[
			'into a group, at its front',
			'top',
			{ kind: 'into', groupId: 'a' },
			['e', 'a', 'top', 'a1', 'a2', 'b', 'b1'],
			SOURCE_ITEMS,
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
			SOURCE_ITEMS,
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
			SOURCE_ITEMS,
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
			SOURCE_ITEMS,
			{ a1: 'b' },
		],
		[
			'a Source Item behind a Source Item',
			's2',
			{
				kind: 'behind',
				of: layer('s1'),
			},
			['e', 'a', 'a1', 'a2', 'b', 'b1', 'top'],
			['s2', 's1'],
			{},
		],
	])('drops a row %s', (_case, dragged, place, items, sources, parents) => {
		const next = dropLayer(LAYOUT, layer(dragged), place);

		expect(order(next).filter(id => !id.startsWith('s'))).toEqual(items);
		expect(next.sources.map(source => source.id)).toEqual(sources);
		for (const [id, parent] of Object.entries(parents))
			expect(parentOf(next, id)).toBe(parent);
	});

	// A row or column group shows a rotated item's drop as refused, and the drop changes nothing.
	it.each<[string, number]>([
		['a', 0.6],
		['a1', 0.2],
	])('refuses a rotated item dropped on %s at %s, with its reason', (over, fraction) => {
		const rotated = layout({ topRotation: 15 });

		expect(layerDropAt(rotated, layer('top'), layer(over), fraction)?.refusal).toBe('rotated-into-arranged-group');
		expect(dropLayer(rotated, layer('top'), { kind: 'into', groupId: 'a' })).toBe(rotated);
	});

	it.each<[string, string, LayerPlace]>([
		[
			'a Graphic Item',
			'top',
			{
				kind: 'behind',
				of: layer('b'),
			},
		],
		[
			'a Source Item',
			's1',
			{
				kind: 'behind',
				of: layer('s2'),
			},
		],
	])('answers the same layout when %s is dropped where it already is', (_case, dragged, place) => {
		expect(dropLayer(LAYOUT, layer(dragged), place)).toBe(LAYOUT);
	});

	// Groups are labelled in the order they were added: `b` Group 1, `a` Group 2, `e` Group 3.
	it.each<[string, string, { topRotation?: number }, Array<[string, LayerPlace, string | null]>]>([
		[
			'a child: out of its group in front of it, then every other group front to back',
			'a1',
			{},
			[
				[
					'Out of Group 2',
					{
						kind: 'in-front-of',
						of: layer('a'),
					},
					null,
				],
				[
					'Group 3',
					{ kind: 'into', groupId: 'e' },
					null,
				],
				[
					'Group 1',
					{ kind: 'into', groupId: 'b' },
					null,
				],
			],
		],
		[
			'a rotated item: every row group, refused',
			'top',
			{ topRotation: 15 },
			[
				[
					'Group 3',
					{ kind: 'into', groupId: 'e' },
					'rotated-into-arranged-group',
				],
				[
					'Group 2',
					{ kind: 'into', groupId: 'a' },
					'rotated-into-arranged-group',
				],
				[
					'Group 1',
					{ kind: 'into', groupId: 'b' },
					'rotated-into-arranged-group',
				],
			],
		],
		[
			'a Graphic Group: nothing',
			'a',
			{},
			[],
		],
		['a Source Item: nothing', 's1', {}, []],
	])('offers "Move to group" for %s', (_case, id, options, moves) => {
		expect(layerGroupMoves(layout(options), layer(id))).toEqual(moves.map(([label, place, refusal]) => ({ label, place, refusal })));
	});
});
