import type { FeatureMatchLayoutEditorLayer } from '~~/app/modules/feature-match-overlay/editorSelection';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import type { FeatureMatchLayoutConfig } from '~~/shared/types/screenConfig';
import { describe, expect, it } from 'vitest';
import {
	isLayerLocked,
	isLockedByGroup,
	lockedLayers,
	readLayerLocks,
	toggleLayerLocks,
} from '~~/app/modules/feature-match-overlay/layerLocks';
import { addGraphicGroupChild, addGraphicItem } from '~~/shared/modules/graphics';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';

/**
 * A Layer Lock keeps a layer from canvas edits (#747): a layer is locked in its
 * own right or through its Graphic Group (E28), and a Source Item locks too.
 */

const CANVAS = { canvasWidth: 1920, canvasHeight: 1080 };

/** Group `g` (children `g1`, `g2`), item `top`, and Source `s1`. */
function layout(): FeatureMatchLayoutConfig {
	const base = structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG).layout;
	let composition: BroadcastGraphicConfig = { ...base.composition, items: [] };
	composition = addGraphicItem(composition, { kind: 'group', id: 'g', ...CANVAS }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'g', id: 'g2' }).graphic;
	composition = addGraphicGroupChild(composition, { kind: 'text', groupId: 'g', id: 'g1' }).graphic;
	composition = addGraphicItem(composition, { kind: 'text', id: 'top', ...CANVAS }).graphic;
	return {
		...base,
		composition,
		sources: [
			{ ...base.sources[0]!, id: 's1' },
		],
	};
}

const LAYOUT = layout();

function layer(id: string): FeatureMatchLayoutEditorLayer {
	return id.startsWith('s')
		? { type: 'source', itemId: id }
		: { type: 'item', itemId: id };
}

describe('feature match layout layer locks', () => {
	it.each<[string, string[], string, boolean]>([
		[
			'a layer locked in its own right',
			['item:top'],
			'top',
			true,
		],
		[
			'a Source Item',
			['source:s1'],
			's1',
			true,
		],
		[
			'a child of a locked group',
			['item:g'],
			'g1',
			true,
		],
		[
			'a group whose child alone is locked',
			['item:g1'],
			'g',
			false,
		],
		[
			'a sibling of a locked child',
			['item:g1'],
			'g2',
			false,
		],
		[
			'a Graphic Item that shares an id with a locked Source Item',
			['source:top'],
			'top',
			false,
		],
		[
			'anything, with nothing locked',
			[],
			'top',
			false,
		],
	])('reads %s as locked: %s → %s', (_, locks, id, locked) => {
		expect(isLayerLocked(LAYOUT, locks, layer(id))).toBe(locked);
	});

	it.each<[string, string[], string, boolean]>([
		[
			'a child of a locked group',
			['item:g'],
			'g1',
			true,
		],
		[
			'a child locked in its own right',
			['item:g1'],
			'g1',
			false,
		],
		[
			'the locked group itself',
			['item:g'],
			'g',
			false,
		],
	])('says whether %s is locked by its group', (_, locks, id, byGroup) => {
		expect(isLockedByGroup(LAYOUT, locks, layer(id))).toBe(byGroup);
	});

	it.each<[string, string[], string[], string[]]>([
		[
			'locks one unlocked layer',
			[],
			['top'],
			['item:top'],
		],
		[
			'unlocks one locked layer',
			['item:top', 'source:s1'],
			['top'],
			['source:s1'],
		],
		[
			'locks every one while any is unlocked',
			['item:top'],
			['top', 's1'],
			['item:top', 'source:s1'],
		],
		[
			'unlocks every one once all are locked',
			['item:top', 'source:s1'],
			['top', 's1'],
			[],
		],
		[
			'cannot unlock a child its group locks',
			['item:g'],
			['g1'],
			['item:g'],
		],
	])('%s', (_, locks, ids, expected) => {
		expect(toggleLayerLocks(LAYOUT, locks, ids.map(layer))).toEqual(expected);
	});

	it('lists every locked layer of the layout, a locked group\'s children included, and none no longer in it', () => {
		expect(lockedLayers(LAYOUT, ['item:g', 'source:s1', 'item:gone'])).toEqual([
			layer('g'),
			layer('g1'),
			layer('g2'),
			layer('s1'),
		]);
	});

	it.each<[string, unknown, string[]]>([
		[
			'a stored list of keys',
			['item:a', 'source:b'],
			['item:a', 'source:b'],
		],
		[
			'a list holding something other than a key',
			['item:a', 3, null, 'canvas', 'item:'],
			['item:a'],
		],
		[
			'something other than a list',
			{ 'item:a': true },
			[],
		],
		['nothing stored', null, []],
	])('reads %s', (_, stored, expected) => {
		expect(readLayerLocks(stored)).toEqual(expected);
	});
});
