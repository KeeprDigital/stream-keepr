import type { FeatureMatchLayoutEditorLayer } from '~~/app/modules/feature-match-overlay/editorSelection';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import { FEATURE_MATCH_LAYOUT_EDITOR_TREE } from '~~/app/modules/feature-match-overlay/editorHost';
import {
	isLayerLocked,
	isLockedByGroup,
	lockedGraphicItems,
	toggleLayerLocks,
} from '~~/app/modules/graphics/editor/layerLocks';
import { addGraphicGroupChild, addGraphicItem, flattenGraphicItems } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { withLayersLocked } from '~~/test/helpers/featureMatchLayoutDocument';

/**
 * A Layer Lock keeps a layer from canvas edits and is stored on the layer: locked
 * in its own right or through its Graphic Group (E28), a Source Item too, and a
 * layer stored without one is unlocked.
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

/** Group `g` (children `g1`, `g2`), item `top`, and Source `s1`; the ids in `locked` stored locked. */
function layout(locked: string[] = []): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	let composition: BroadcastGraphicConfig = { ...base.composition, items: [] };
	composition = addGraphicItem(composition, { kind: 'group', id: 'g', ...CANVAS }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'g', id: 'g2' }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'g', id: 'g1' }).graphic;
	composition = addGraphicItem(composition, { kind: 'text', id: 'top', ...CANVAS }).graphic;
	return withLayersLocked({
		...base,
		composition,
		sources: [
			{ ...base.sources[0]!, id: 's1' },
		],
	}, locked);
}

/** Each layer stored with a `locked` field, and what it holds. */
function storedLocks(stored: FeatureMatchLayoutConfig): Record<string, unknown> {
	return Object.fromEntries([
		...flattenGraphicItems(stored.composition),
		...stored.sources,
	].filter(item => 'locked' in item).map(item => [item.id, item.locked]));
}

function layer(id: string): FeatureMatchLayoutEditorLayer {
	return id.startsWith('s')
		? { type: 'source', itemId: id }
		: { type: 'item', itemId: id };
}

describe('feature match layout layer locks', () => {
	it.each<[string, string[], string, boolean]>([
		[
			'a layer locked in its own right',
			['top'],
			'top',
			true,
		],
		[
			'a Source Item',
			['s1'],
			's1',
			true,
		],
		[
			'a child of a locked group',
			['g'],
			'g1',
			true,
		],
		[
			'a group whose child alone is locked',
			['g1'],
			'g',
			false,
		],
		[
			'a sibling of a locked child',
			['g1'],
			'g2',
			false,
		],
		[
			'a layer stored without a lock',
			[],
			'top',
			false,
		],
	])('reads %s as locked: %s → %s', (_, locked, id, expected) => {
		expect(isLayerLocked(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout(locked), layer(id))).toBe(expected);
	});

	it.each<[string, string[], string, boolean]>([
		[
			'a child of a locked group',
			['g'],
			'g1',
			true,
		],
		[
			'a child locked in its own right',
			['g1'],
			'g1',
			false,
		],
		[
			'the locked group itself',
			['g'],
			'g',
			false,
		],
	])('says whether %s is locked by its group', (_, locked, id, byGroup) => {
		expect(isLockedByGroup(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout(locked), layer(id))).toBe(byGroup);
	});

	it.each<[string, string[], string[], Record<string, unknown>]>([
		[
			'locks one unlocked layer',
			[],
			['top'],
			{ top: true },
		],
		[
			'unlocks one locked layer, storing it without a lock',
			['top', 's1'],
			['top'],
			{ s1: true },
		],
		[
			'locks every one while any is unlocked',
			['top'],
			['top', 's1'],
			{ top: true, s1: true },
		],
		[
			'unlocks every one once all are locked',
			['top', 's1'],
			['top', 's1'],
			{},
		],
		[
			'cannot unlock a child its group locks',
			['g'],
			['g1'],
			{ g: true },
		],
		[
			'locks a group child in its own right',
			[],
			['g1'],
			{ g1: true },
		],
	])('%s', (_, locked, ids, expected) => {
		expect(storedLocks(toggleLayerLocks(FEATURE_MATCH_LAYOUT_EDITOR_TREE, layout(locked), ids.map(layer)))).toEqual(expected);
	});

	it('writes nothing toggling a child locked only through its group', () => {
		const locked = layout(['g']);

		expect(toggleLayerLocks(FEATURE_MATCH_LAYOUT_EDITOR_TREE, locked, [
			layer('g1'),
		])).toBe(locked);
	});

	it.each<[string, string[], string[]]>([
		[
			'a locked group with its children',
			['g'],
			['g', 'g2', 'g1'],
		],
		[
			'a child locked in its own right alone',
			['g1'],
			['g1'],
		],
		[
			'no Source Item, which is no Graphic Item',
			['top', 's1'],
			['top'],
		],
	])('lists %s among the locked Graphic Items', (_, locked, ids) => {
		const { composition } = layout(locked);

		expect(lockedGraphicItems([composition]).map(item => item.itemId).sort()).toEqual([...ids].sort());
		expect(lockedGraphicItems([composition]).every(item => item.graphicId === composition.id)).toBe(true);
	});
});
