import type { BroadcastGraphicsEditorLayer } from '~~/app/modules/broadcast-graphics/editorHost';
import type { BroadcastGraphicConfig } from '~~/shared/types/graphics';
import { beforeEach, describe, expect, it } from 'vitest';
import { broadcastGraphicsEditorHost, broadcastGraphicsEditorTree, PRESENTATION_GROUP_REMOVAL } from '~~/app/modules/broadcast-graphics/editorHost';
import { dropLayer, layerDropAt } from '~~/app/modules/graphics/editor/layerDrag';
import { editorSelectionFrame } from '~~/app/modules/graphics/editor/layerFrame';
import { isLayerLocked, toggleLayerLocks } from '~~/app/modules/graphics/editor/layerLocks';
import { extendLayerSelection, onlyLayer, toggleLayer } from '~~/app/modules/graphics/editor/layerSelection';
import { group, shape, text } from '~~/test/helpers/graphicsComposition';

/**
 * The shared editor's rules where the Broadcast Graphics host takes a branch
 * the Feature Match Layout's cannot: its document is a stack of compositions,
 * a Graphic Item's id is unique within its Broadcast Graphic only, and an undo
 * restores around what is on air and which Graphic Channel each graphic is in.
 */

type Layer = BroadcastGraphicsEditorLayer;
type Stack = readonly BroadcastGraphicConfig[];

const SLATE = 'slate';
const LOWER_THIRD = 'lower-third';
const CANVAS = { width: 1920, height: 1080 };

const slate: BroadcastGraphicConfig = {
	id: SLATE,
	name: 'Slate',
	items: [
		text('a', { x: 40, y: 40 }),
		text('s', { x: 700, y: 500 }),
	],
};
const lowerThird: BroadcastGraphicConfig = {
	id: LOWER_THIRD,
	name: 'Lower Third',
	items: [
		shape('a', { x: 10, y: 20 }),
		group('g', [
			text('g1'),
		]),
		shape('bar', { x: 400, y: 600 }),
	],
};
/** Back to front. Both Broadcast Graphics hold a Graphic Item `a`. */
const STACK: Stack = [slate, lowerThird];

const layer = (graphicId: string, itemId: string): Layer => ({ type: 'item', graphicId, itemId });

/** The Broadcast Graphic the host has selected while no layer is. */
let hostSelected: string | null = null;
const tree = broadcastGraphicsEditorTree(() => hostSelected);

const keys = (layers: readonly Layer[]) => layers.map(tree.key);
const itemIds = (stack: Stack, graphicId: string) => stack.find(graphic => graphic.id === graphicId)?.items.map(item => item.id);

describe('the Broadcast Graphics editor tree', () => {
	beforeEach(() => {
		hostSelected = null;
	});

	it('lists the front Broadcast Graphic\'s layers first, each front to back, a group\'s children beneath it', () => {
		expect(keys(tree.order(STACK))).toEqual([
			'item:lower-third:bar',
			'item:lower-third:g',
			'item:lower-third:g1',
			'item:lower-third:a',
			'item:slate:s',
			'item:slate:a',
		]);
	});

	// Align, group and paste act within one composition, so a selection never spans two.
	it.each<{ click: string; select: typeof toggleLayer; from: Layer; to: Layer; selected: string[] }>([
		{
			click: '⌘-click on a layer of another Broadcast Graphic',
			select: toggleLayer,
			from: layer(LOWER_THIRD, 'bar'),
			to: layer(SLATE, 's'),
			selected: ['item:slate:s'],
		},
		{
			click: '⌘-click on another Broadcast Graphic\'s item of the same id',
			select: toggleLayer,
			from: layer(LOWER_THIRD, 'a'),
			to: layer(SLATE, 'a'),
			selected: ['item:slate:a'],
		},
		{
			click: 'Shift-click reaching into another Broadcast Graphic',
			select: extendLayerSelection,
			from: layer(LOWER_THIRD, 'bar'),
			to: layer(SLATE, 'a'),
			selected: ['item:slate:s', 'item:slate:a'],
		},
	])('$click selects $selected', ({ select, from, to, selected }) => {
		expect(keys(select(tree, STACK, onlyLayer(from), to).layers)).toEqual(selected);
	});

	it('locks a Graphic Item in its own Broadcast Graphic, leaving another\'s item of the same id unlocked', () => {
		const locked = toggleLayerLocks(tree, STACK, [
			layer(LOWER_THIRD, 'a'),
		]);

		expect(isLayerLocked(tree, locked, layer(LOWER_THIRD, 'a'))).toBe(true);
		expect(isLayerLocked(tree, locked, layer(SLATE, 'a'))).toBe(false);
		expect(locked[0]).toBe(slate);
	});

	// The others may never share program with it.
	it('snaps a layer to the items of its own Broadcast Graphic, and to none of another', () => {
		const snapLines = (stack: Stack) => editorSelectionFrame(tree, stack, layer(LOWER_THIRD, 'bar'), CANVAS)!.snapLines;
		const alone = snapLines([lowerThird]);

		expect(snapLines(STACK)).toEqual(alone);
		expect(snapLines([
			{
				...lowerThird,
				items: [slate.items[1]!, ...lowerThird.items],
			},
		])).not.toEqual(alone);
	});

	describe('reordering', () => {
		it.each<[string, Layer]>([
			[
				'a layer of another Broadcast Graphic',
				layer(SLATE, 's'),
			],
			[
				'another Broadcast Graphic\'s item of the same id',
				layer(SLATE, 'a'),
			],
		])('offers no drop over %s', (_, over) => {
			expect(layerDropAt(tree, STACK, layer(LOWER_THIRD, 'a'), over, 0.25)).toBeNull();
		});

		it('moves a layer within its own Broadcast Graphic, leaving the others as they are', () => {
			const dropped = dropLayer(tree, STACK, layer(LOWER_THIRD, 'bar'), {
				kind: 'behind',
				of: layer(LOWER_THIRD, 'a'),
			});

			expect(itemIds(dropped, LOWER_THIRD)).toEqual(['bar', 'a', 'g']);
			expect(dropped[0]).toBe(slate);
		});
	});

	// A new or pasted item joins the selection's Broadcast Graphic, or the one the host has selected.
	it.each<{ selected: Layer[]; host: string | null; destination: string | null }>([
		{
			selected: [
				layer(SLATE, 's'),
			],
			host: LOWER_THIRD,
			destination: SLATE,
		},
		{
			selected: [],
			host: LOWER_THIRD,
			destination: LOWER_THIRD,
		},
		{
			selected: [],
			host: null,
			destination: null,
		},
		{
			selected: [],
			host: 'since deleted',
			destination: null,
		},
	])('adds to $destination with $selected selected and the host on $host', ({ selected, host, destination }) => {
		hostSelected = host;

		expect(tree.destination(STACK, selected)?.id ?? null).toBe(destination);
	});

	it.each<[string, string, string[]]>([
		[
			'in its place',
			SLATE,
			[SLATE, LOWER_THIRD],
		],
		[
			'at the front, where the stack no longer holds it',
			'removed since',
			[SLATE, LOWER_THIRD, 'removed since'],
		],
	])('writes a Broadcast Graphic back %s', (_, id, stacked) => {
		const written = { ...slate, id, name: 'Written' };

		const next = tree.withComposition(STACK, written);

		expect(next.map(graphic => graphic.id)).toEqual(stacked);
		expect(next.find(graphic => graphic.id === id)).toBe(written);
	});

	// A projection reads its Presentation Group, so the two go together or not at all.
	it.each<[string, string, string | null]>([
		['its Presentation Group', 'g', PRESENTATION_GROUP_REMOVAL],
		['any other layer', 'bar', null],
	])('answers a removal of a Social Profile Projection\'s Broadcast Graphic\'s %s with %s', (_, itemId, refusal) => {
		const projecting: Stack = [
			slate,
			{
				...lowerThird,
				socialProfileProjections: [
					{ presentationGroupId: 'g' },
				],
			} as BroadcastGraphicConfig,
		];

		expect(tree.removal!(projecting, layer(LOWER_THIRD, itemId))).toBe(refusal);
	});

	describe('pasting copied layers', () => {
		const copied = tree.copy(STACK, [
			layer(LOWER_THIRD, 'bar'),
		])!;
		const pasteInto = (selected: Layer[]) => tree.paste(copied, STACK, {
			selected,
			nextId: () => 'pasted',
		});

		it('pastes into the Broadcast Graphic the host has selected, naming the copies as its layers', () => {
			hostSelected = SLATE;

			const outcome = pasteInto([]);

			expect(outcome).toMatchObject({
				ok: true,
				pasted: [
					layer(SLATE, 'pasted'),
				],
			});
			expect(outcome.ok && itemIds(outcome.document, SLATE)).toEqual(['a', 's', 'pasted']);
			expect(outcome.ok && outcome.document[1]).toBe(lowerThird);
		});

		it('refuses with no Broadcast Graphic to paste into', () => {
			expect(pasteInto([])).toEqual({
				ok: false,
				refusal: { reason: 'no-destination' },
			});
		});
	});
});

/** What an undo writes: the restored stack, around what the stack holds now that undo does not cover. */
describe('the Broadcast Graphics host restoring a stack', () => {
	function restore(restored: Stack, current: Stack, { onAir = [] as string[], channels = [] as string[] } = {}) {
		return broadcastGraphicsEditorHost({
			graphics: () => current,
			channels: () => channels.map(id => ({ id, name: id })),
			write: () => {},
			selectedGraphicId: () => null,
			canvasWidth: CANVAS.width,
			canvasHeight: CANVAS.height,
			writable: true,
			onAir: graphicId => onAir.includes(graphicId),
		}).document.restore!(restored, current);
	}

	// A Graphic Channel is assigned beside the stack, outside undo.
	it.each<{ graphic: string; restoredIn?: string; nowIn?: string | null; channels: string[]; keeps?: string }>([
		{
			graphic: 'one moved to another Graphic Channel since',
			restoredIn: 'thirds',
			nowIn: 'bugs',
			channels: ['thirds', 'bugs'],
			keeps: 'bugs',
		},
		{
			graphic: 'one taken out of its Graphic Channel since',
			restoredIn: 'thirds',
			nowIn: undefined,
			channels: ['thirds'],
			keeps: undefined,
		},
		{
			graphic: 'one deleted since, whose Graphic Channel still exists',
			restoredIn: 'thirds',
			nowIn: null,
			channels: ['thirds'],
			keeps: 'thirds',
		},
		{
			graphic: 'one deleted since, whose Graphic Channel is gone too',
			restoredIn: 'thirds',
			nowIn: null,
			channels: [],
			keeps: undefined,
		},
	])('restores $graphic in Graphic Channel $keeps', ({ restoredIn, nowIn, channels, keeps }) => {
		const restored: Stack = [
			slate,
			{ ...lowerThird, channelId: restoredIn },
		];
		const current: Stack = nowIn === null
			? [slate]
			: [
					slate,
					{ ...lowerThird, channelId: nowIn },
				];

		const [, graphic] = restore(restored, current, { channels });

		expect(graphic!.channelId).toBe(keeps);
		expect('channelId' in graphic!).toBe(keeps !== undefined);
	});

	// Graphics on air composite in stack order, so their order is on program too.
	it('leaves the Broadcast Graphics on air in the order they hold now, and reorders the rest around them', () => {
		const bug: BroadcastGraphicConfig = { id: 'bug', name: 'Bug', items: [] };

		const order = restore([lowerThird, bug, slate], [slate, bug, lowerThird], {
			onAir: [SLATE, LOWER_THIRD],
		})
			.map(graphic => graphic.id);

		expect(order).toEqual([SLATE, 'bug', LOWER_THIRD]);
	});
});
