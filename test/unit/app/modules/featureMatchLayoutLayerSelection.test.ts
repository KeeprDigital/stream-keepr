import type { FeatureMatchLayoutEditorLayer } from '~~/app/modules/feature-match-overlay/editorSelection';
import type { LayerSelection } from '~~/app/modules/feature-match-overlay/layerSelection';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	collapseLayerSelection,
	extendLayerSelection,
	layerOrder,
	NO_LAYERS,
	onlyLayer,
	pruneLayerSelection,
	toggleLayer,
} from '~~/app/modules/feature-match-overlay/layerSelection';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * The editor's selection of several layers: built by toggling and by range,
 * collapsed by Escape, and never holding a Graphic Group with its own child or
 * children of two groups (E9, #740).
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

/** Front to back: group `a` (children `a1`, `a2`), group `b` (child `b1`), item `top`; then Sources `s2`, `s1`. */
function layout(): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	let composition: BroadcastGraphicConfig = { ...base.composition, items: [] };
	composition = addGraphicItem(composition, { kind: 'text', id: 'top', ...CANVAS }).graphic;
	composition = addGraphicItem(composition, { kind: 'group', id: 'b', ...CANVAS }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'b', id: 'b1' }).graphic;
	composition = addGraphicItem(composition, { kind: 'group', id: 'a', ...CANVAS }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'a', id: 'a2' }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'a', id: 'a1' }).graphic;
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

function layer(key: string): FeatureMatchLayoutEditorLayer {
	return key.startsWith('s')
		? { type: 'source', itemId: key }
		: { type: 'item', itemId: key };
}

function selecting(...keys: string[]): LayerSelection {
	return keys.reduce<LayerSelection>((selection, key) => toggleLayer(LAYOUT, selection, layer(key)), NO_LAYERS);
}

function ids(selection: LayerSelection) {
	return {
		layers: selection.layers.map(entry => entry.itemId),
		anchor: selection.anchor?.itemId ?? null,
	};
}

describe('feature match layout layer selection', () => {
	it('orders layers as the layer list does: Graphic Items front to back, each group\'s children beneath it, then Sources front to back', () => {
		expect(layerOrder(LAYOUT).map(entry => entry.itemId)).toEqual([
			'a',
			'a1',
			'a2',
			'b',
			'b1',
			'top',
			's2',
			's1',
		]);
	});

	it.each([
		{
			name: 'adds a layer, which becomes the anchor',
			start: ['top'],
			toggle: 's1',
			layers: ['top', 's1'],
			anchor: 's1',
		},
		{
			name: 'mixes Source Items and Graphic Items (E8)',
			start: ['s1'],
			toggle: 'a',
			layers: ['s1', 'a'],
			anchor: 'a',
		},
		{
			name: 'removes a selected layer, anchoring on the last one left',
			start: ['top', 's1', 's2'],
			toggle: 's2',
			layers: ['top', 's1'],
			anchor: 's1',
		},
		{
			name: 'removes the only layer, leaving none',
			start: ['top'],
			toggle: 'top',
			layers: [],
			anchor: null,
		},
		{
			name: 'keeps children of one group together',
			start: ['a1'],
			toggle: 'a2',
			layers: ['a1', 'a2'],
			anchor: 'a2',
		},
		{
			name: 'keeps a group child with a top-level layer',
			start: ['a1'],
			toggle: 'top',
			layers: ['a1', 'top'],
			anchor: 'top',
		},
		{
			name: 'replaces a group with its own child (E9)',
			start: ['a', 'top'],
			toggle: 'a1',
			layers: ['a1'],
			anchor: 'a1',
		},
		{
			name: 'replaces a child with its own group (E9)',
			start: ['a1', 's1'],
			toggle: 'a',
			layers: ['a'],
			anchor: 'a',
		},
		{
			name: 'replaces a child of another group (E9)',
			start: ['a1', 'top'],
			toggle: 'b1',
			layers: ['b1'],
			anchor: 'b1',
		},
	])('toggling $name', ({ start, toggle, layers, anchor }) => {
		expect(ids(toggleLayer(LAYOUT, selecting(...start), layer(toggle)))).toEqual({ layers, anchor });
	});

	it.each([
		{
			name: 'selects every layer from the anchor to the one clicked, keeping the anchor',
			start: ['top'],
			to: 's1',
			layers: ['top', 's2', 's1'],
			anchor: 'top',
		},
		{
			name: 'runs upward as well as down',
			start: ['s1'],
			to: 'b1',
			layers: ['s1', 's2', 'top', 'b1'],
			anchor: 's1',
		},
		{
			name: 'replaces layers selected outside it',
			start: ['a', 's1'],
			to: 'top',
			layers: ['s1', 's2', 'top'],
			anchor: 's1',
		},
		{
			name: 'is the layer clicked when nothing is selected',
			start: [],
			to: 'a1',
			layers: ['a1'],
			anchor: 'a1',
		},
		{
			name: 'takes a group beside another group\'s child',
			start: ['a2'],
			to: 'b',
			layers: ['a2', 'b'],
			anchor: 'a2',
		},
		{
			name: 'restarts at a layer that breaks E9, as adding it would',
			start: ['a1'],
			to: 'b1',
			layers: ['b1'],
			anchor: 'b1',
		},
	])('a range $name', ({ start, to, layers, anchor }) => {
		expect(ids(extendLayerSelection(LAYOUT, selecting(...start), layer(to)))).toEqual({ layers, anchor });
	});

	it.each([
		{
			name: 'several to the anchor',
			start: ['top', 's1', 'a'],
			layers: ['a'],
			anchor: 'a',
		},
		{
			name: 'one to none',
			start: ['top'],
			layers: [],
			anchor: null,
		},
		{
			name: 'none to none',
			start: [],
			layers: [],
			anchor: null,
		},
	])('escape collapses $name', ({ start, layers, anchor }) => {
		expect(ids(collapseLayerSelection(selecting(...start)))).toEqual({ layers, anchor });
	});

	it('selects only the layer clicked', () => {
		expect(ids(onlyLayer(layer('b1')))).toEqual({
			layers: ['b1'],
			anchor: 'b1',
		});
	});

	it('drops layers that have left the layout, re-anchoring if the anchor went', () => {
		const selection = selecting('top', 's1');
		const without = {
			...LAYOUT,
			sources: LAYOUT.sources.filter(source => source.id !== 's1'),
		};

		expect(ids(pruneLayerSelection(without, selection))).toEqual({
			layers: ['top'],
			anchor: 'top',
		});
		expect(pruneLayerSelection(LAYOUT, selection)).toBe(selection);
	});
});
