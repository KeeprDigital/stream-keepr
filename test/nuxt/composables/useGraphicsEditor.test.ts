import type { GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicsEditorHarness, GraphicsEditorHostFixture } from '~~/test/nuxt/helpers/graphicsEditorHosts';
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { findGraphicItem } from '~~/shared/modules/graphics';
import { group, media, shape, surfaceStyle, text } from '~~/test/helpers/graphicsComposition';
import {
	broadcastGraphicsEditing,
	EDITED_GRAPHIC_ID,
	featureMatchLayoutEditing,
	GRAPHICS_EDITOR_HOSTS,
	OTHER_GRAPHIC_ID,
} from '~~/test/nuxt/helpers/graphicsEditorHosts';
import { copyGraphicStyle } from '~/modules/graphics/clipboard';

/**
 * The shared graphics editor, run against every host's contract: its writes are
 * undoable, only a Graphics Authoring Lease holder writes, and several selected
 * layers, Layer Locks, grouping, alignment and the clipboard behave alike.
 */

type Editing = GraphicsEditorHarness;
type Editor = Editing['editor'];

/** Three top-level items, apart; a row group `g` holding `g1` and `g2`. */
function items(): GraphicItemConfig[] {
	return [
		text('a', { x: 10, y: 10 }),
		text('b', { x: 500, y: 300 }),
		text('c', { x: 1000, y: 600 }),
		group('g', [
			text('g1'),
			text('g2'),
		]),
	];
}

function rect(editing: Pick<Editing, 'composition'>, id: string) {
	const item = findGraphicItem(editing.composition(), id)?.item;
	return item && {
		x: item.x,
		y: item.y,
		width: item.width,
		height: item.height,
		visible: item.visible,
	};
}

function topLevelIds(editing: Editing) {
	return editing.composition().items.map(item => item.id);
}

describe.each<GraphicsEditorHostFixture>(GRAPHICS_EDITOR_HOSTS)('the shared graphics editor on the $name host', (host) => {
	/** An editor with `a` selected. */
	function editing(writable = true, start = items()): Editing {
		const harness = host.editing({ writable, items: start });
		harness.editor.select(harness.layer('a'));
		return harness;
	}

	/** An editor with `a`, `b` and `c` selected; they cover (10, 10) to (1400, 680). */
	function severalSelected(): Editing {
		const harness = editing();
		harness.editor.toggleSelect(harness.layer('b'));
		harness.editor.toggleSelect(harness.layer('c'));
		return harness;
	}

	const SELECTED = ['a', 'b', 'c'];

	describe('without the lease', () => {
		it.each<[string, (editor: Editor, at: Editing['layer']) => void]>([
			[
				'edit',
				editor => editor.setLayersGeometry({ x: 5 }),
			],
			[
				'add a Graphic Item',
				editor => editor.addItem('text'),
			],
			[
				'remove',
				editor => editor.remove(),
			],
			[
				'paste layers',
				editor => editor.paste(editor.copy()!),
			],
			[
				'paste a style',
				editor => editor.pasteStyle(copyGraphicStyle(host.hostId, shape('from'))),
			],
			[
				'duplicate',
				editor => editor.duplicate(),
			],
			[
				'reorder',
				(editor, at) => editor.moveToEdge(at('a'), 'front'),
			],
			[
				'hide',
				editor => editor.toggleVisible(),
			],
			[
				'lock',
				editor => editor.toggleLock(),
			],
			[
				'rename',
				(editor, at) => editor.rename(at('a'), 'Renamed'),
			],
			[
				'move on the canvas',
				(editor, at) => editor.setRect(at('a'), { x: 1, y: 2, width: 3, height: 4 }),
			],
			[
				'nudge',
				editor => editor.nudge({ x: 1, y: 0 }),
			],
			[
				'record a checkpoint',
				editor => editor.checkpoint(),
			],
			[
				'align',
				editor => editor.align('right'),
			],
			[
				'group',
				(editor, at) => {
					editor.toggleSelect(at('b'));
					editor.group();
				},
			],
			[
				'ungroup',
				(editor, at) => editor.ungroup(at('g')),
			],
		])('writes nothing on %s', async (_, verb) => {
			const harness = editing(false);

			verb(harness.editor, harness.layer);
			await nextTick();

			expect(harness.writes).toEqual([]);
			expect(harness.editor.canUndo.value).toBe(false);
		});

		it('clears undo and redo history on losing the lease, and does not restore it on regaining it', async () => {
			const { editor, leased } = editing();
			editor.toggleVisible();
			editor.toggleVisible();
			editor.undo();
			expect([editor.canUndo.value, editor.canRedo.value]).toEqual([true, true]);

			leased.value = false;
			await nextTick();
			expect([editor.canUndo.value, editor.canRedo.value]).toEqual([false, false]);

			leased.value = true;
			await nextTick();
			expect([editor.canUndo.value, editor.canRedo.value]).toEqual([false, false]);
		});
	});

	describe('undo and redo', () => {
		it('undoes and redoes each edit as one step', () => {
			const harness = editing();
			const { editor } = harness;

			editor.toggleVisible();
			editor.nudge({ x: 5, y: 0 });
			expect([rect(harness, 'a')?.visible, rect(harness, 'a')?.x]).toEqual([false, 15]);

			editor.undo();
			expect([rect(harness, 'a')?.visible, rect(harness, 'a')?.x]).toEqual([false, 10]);
			editor.undo();
			expect([rect(harness, 'a')?.visible, editor.canUndo.value]).toEqual([true, false]);
			editor.redo();
			editor.redo();
			expect([rect(harness, 'a')?.visible, rect(harness, 'a')?.x, editor.canRedo.value]).toEqual([false, 15, false]);
		});

		it('undoes a gesture as one step however long it pauses, and joins it to no edit around it', () => {
			const clock = { now: 1_000 };
			vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
			const harness = editing();
			const { editor } = harness;
			function editX(xs: number[], msApart: number) {
				for (const x of xs) {
					clock.now += msApart;
					editor.setLayersGeometry({ x });
				}
			}

			editX([90], 10);
			editor.beginGesture();
			editX([80, 70, 60], 2_000);
			editor.endGesture();
			editX([50], 10);

			const undone = [rect(harness, 'a')?.x];
			while (editor.canUndo.value) {
				editor.undo();
				undone.push(rect(harness, 'a')?.x);
			}
			vi.restoreAllMocks();
			expect(undone).toEqual([50, 60, 90, 10]);
		});

		// A template placement rewrites the stored document: an edit, undo or redo
		// made meanwhile would write a whole document from before it over the placed one.
		it.each<[string, (editor: Editor) => void]>([
			[
				'an edit',
				editor => editor.toggleVisible(),
			],
			[
				'undo',
				editor => editor.undo(),
			],
			[
				'redo',
				editor => editor.redo(),
			],
		])('writes nothing on %s while the host holds the editor, and offers none', (_, verb) => {
			const harness = editing();
			harness.editor.toggleVisible();
			harness.editor.toggleVisible();
			harness.editor.undo();
			harness.writes.length = 0;
			harness.held.value = true;

			verb(harness.editor);

			expect(harness.writes).toEqual([]);
			expect([harness.editor.writable.value, harness.editor.canUndo.value, harness.editor.canRedo.value]).toEqual([false, false, false]);
		});

		it('keeps its history while held, and undoes the host\'s own write as one more step', async () => {
			const harness = editing();
			harness.editor.toggleVisible();
			harness.held.value = true;
			const replaced = JSON.parse(JSON.stringify(harness.composition().items));

			harness.editor.checkpoint();
			harness.storeItems([]);
			harness.held.value = false;
			await nextTick();

			harness.editor.undo();
			expect(harness.composition().items).toEqual(replaced);
			expect(harness.editor.canUndo.value).toBe(true);
		});
	});

	/** Several layers selected act together, each verb one undo step. */
	describe('with several layers selected', () => {
		it.each<[string, (editor: Editor) => void, { x: number; y: number }]>([
			[
				'a canvas drag of the box they cover, over two frames of one gesture',
				(editor) => {
					editor.setSelectionRect({
						x: 20,
						y: 5,
						width: 1390,
						height: 670,
					}, { coalesce: 'canvas:1' });
					editor.setSelectionRect({
						x: 24,
						y: 7,
						width: 1390,
						height: 670,
					}, { coalesce: 'canvas:1' });
				},
				{ x: 14, y: -3 },
			],
			[
				'a run of nudges',
				(editor) => {
					editor.nudge({ x: -10, y: 0 });
					editor.nudge({ x: 0, y: 1 });
				},
				{ x: -10, y: 1 },
			],
		])('moves every one by the same delta on %s, as one undo step', (_, gesture, delta) => {
			const harness = severalSelected();
			const before = SELECTED.map(id => rect(harness, id));

			gesture(harness.editor);

			expect(SELECTED.map(id => rect(harness, id))).toEqual(before.map(box => ({ ...box, x: box!.x + delta.x, y: box!.y + delta.y })));
			harness.editor.undo();
			expect(SELECTED.map(id => rect(harness, id))).toEqual(before);
			expect(harness.editor.canUndo.value).toBe(false);
		});

		it.each<[string, (editor: Editor) => void, (harness: Editing) => unknown]>([
			[
				'deletes every one',
				editor => editor.remove(),
				harness => SELECTED.map(id => rect(harness, id)),
			],
			[
				'hides every one',
				editor => editor.toggleVisible(),
				harness => SELECTED.map(id => rect(harness, id)?.visible),
			],
			[
				'duplicates every one',
				editor => editor.duplicate(),
				harness => harness.composition().items.length,
			],
			[
				'writes shared geometry to every one',
				editor => editor.setLayersGeometry({ x: 5, height: 60 }),
				harness => SELECTED.map(id => rect(harness, id)),
			],
		])('%s as one undo step', (_, verb, read) => {
			const harness = severalSelected();
			const before = read(harness);

			verb(harness.editor);

			expect(harness.writes).toHaveLength(1);
			expect(read(harness)).not.toEqual(before);
			harness.editor.undo();
			expect(read(harness)).toEqual(before);
		});

		it('selects the copies after duplicating, and nothing after deleting', () => {
			const harness = severalSelected();
			const { editor } = harness;

			editor.duplicate();
			expect(editor.layers.value).toHaveLength(3);
			for (const id of SELECTED)
				expect(editor.layers.value).not.toContainEqual(harness.layer(id));

			editor.remove();
			expect(editor.layers.value).toEqual([]);
			expect(editor.selection.value).toEqual({ type: 'canvas' });
		});

		it('acts with a single-layer verb on none of them, since no one layer is the selection', () => {
			const harness = severalSelected();
			const order = topLevelIds(harness);

			harness.editor.moveToEdge(harness.editor.selection.value, 'front');

			expect(harness.editor.selection.value).toEqual({ type: 'canvas' });
			expect(topLevelIds(harness)).toEqual(order);
		});

		it('lets go of a layer someone else removes, keeping the rest', async () => {
			const harness = severalSelected();

			harness.storeItems(harness.composition().items.filter(item => item.id !== 'b'));
			await nextTick();

			expect(harness.editor.layers.value).toEqual([
				harness.layer('a'),
				harness.layer('c'),
			]);
		});

		it('never holds a group with its own child', () => {
			const harness = editing();
			harness.editor.select(harness.layer('g'));

			harness.editor.toggleSelect(harness.layer('g1'));

			expect(harness.editor.layers.value).toEqual([
				harness.layer('g1'),
			]);
		});
	});

	/** A locked layer is left alone by the canvas and arrow nudges, and edited by its panel. */
	describe('with Layer Locks', () => {
		function storeLocked(harness: Editing, ids: string[]) {
			harness.storeItems(harness.composition().items.map(item => ids.includes(item.id)
				? { ...item, locked: true }
				: item));
		}

		it('locks the selected layer in the document, as one undo step', () => {
			const harness = editing();

			harness.editor.toggleLock();

			expect(harness.writes).toHaveLength(1);
			expect(findGraphicItem(harness.composition(), 'a')?.item.locked).toBe(true);
			expect(harness.editor.isLocked(harness.layer('a'))).toBe(true);
			harness.editor.undo();
			expect(findGraphicItem(harness.composition(), 'a')?.item).not.toHaveProperty('locked');
		});

		it('locks a group\'s children with it, so a child\'s own lock cannot free it', () => {
			const harness = editing();
			storeLocked(harness, ['g']);

			expect([
				harness.editor.isLocked(harness.layer('g1')),
				harness.editor.isLockedByItsGroup(harness.layer('g1')),
			]).toEqual([true, true]);
		});

		it.each<[string, (editor: Editor, at: Editing['layer']) => void]>([
			[
				'an arrow nudge',
				editor => editor.nudge({ x: 5, y: 0 }),
			],
			[
				'a canvas move',
				(editor, at) => editor.setRect(at('a'), { x: 1, y: 2, width: 3, height: 4 }),
			],
			[
				'a canvas drag of the selection',
				editor => editor.setSelectionRect({ x: 1, y: 2, width: 3, height: 4 }),
			],
			[
				'a canvas rotation',
				(editor, at) => editor.setRotation(at('a'), 45),
			],
		])('leaves a locked layer alone on %s, offering the canvas nothing to move', (_, verb) => {
			const harness = editing();
			storeLocked(harness, ['a']);

			verb(harness.editor, harness.layer);

			expect(harness.writes).toEqual([]);
			expect(harness.editor.selectionFrame.value).toBeNull();
		});

		it('nudges only the unlocked layers of several selected, and the panel still edits all', () => {
			const harness = editing();
			harness.editor.toggleSelect(harness.layer('b'));
			storeLocked(harness, ['a']);

			harness.editor.nudge({ x: 5, y: 0 });
			expect([rect(harness, 'a')?.x, rect(harness, 'b')?.x]).toEqual([10, 505]);

			harness.editor.setLayersGeometry({ x: 7 });
			expect([rect(harness, 'a')?.x, rect(harness, 'b')?.x]).toEqual([7, 7]);
		});
	});

	/** ⌘G and ⌘⇧G, each one undo step. */
	describe('grouping and ungrouping', () => {
		it('groups the selected Graphic Items as one undo step, and selects the new group', () => {
			const harness = editing();
			harness.editor.toggleSelect(harness.layer('b'));
			const before = topLevelIds(harness);

			harness.editor.group();

			expect(harness.writes).toHaveLength(1);
			const created = harness.composition().items.find(item => !before.includes(item.id));
			expect(created?.type === 'group' && created.children.map(child => child.id)).toEqual(['a', 'b']);
			expect(harness.editor.layers.value).toEqual([
				harness.layer(created!.id),
			]);
			harness.editor.undo();
			expect(topLevelIds(harness)).toEqual(before);
		});

		it('ungroups the selected group as one undo step, and selects its former children', () => {
			const harness = editing();
			harness.editor.select(harness.layer('g'));
			const before = topLevelIds(harness);

			harness.editor.ungroup();

			expect(topLevelIds(harness)).not.toContain('g');
			expect(harness.editor.layers.value).toHaveLength(2);
			expect(harness.editor.layers.value).toContainEqual(harness.layer('g1'));
			harness.editor.undo();
			expect(topLevelIds(harness)).toEqual(before);
		});

		it.each<[string, (harness: Editing) => void]>([
			[
				'grouping layers already in a group',
				(harness) => {
					harness.editor.select(harness.layer('g1'));
					harness.editor.toggleSelect(harness.layer('g2'));
					harness.editor.group();
				},
			],
			[
				'ungrouping a layer that is not a group',
				harness => harness.editor.ungroup(harness.layer('a')),
			],
		])('writes nothing %s', (_, verb) => {
			const harness = editing();

			verb(harness);

			expect(harness.writes).toEqual([]);
		});
	});

	/** Align and distribute move the selected layers, each command one undo step. */
	describe('aligning and distributing', () => {
		it.each<[string, (editor: Editor) => void, (harness: Editing) => unknown]>([
			[
				'aligns them to the bounds they cover',
				editor => editor.align('bottom'),
				harness => SELECTED.map(id => rect(harness, id)?.y),
			],
			[
				'distributes them',
				editor => editor.distribute('y'),
				harness => SELECTED.map(id => rect(harness, id)?.y),
			],
		])('%s as one undo step', (_, verb, read) => {
			const harness = severalSelected();
			const before = read(harness);

			verb(harness.editor);

			expect(harness.writes).toHaveLength(1);
			expect(read(harness)).not.toEqual(before);
			harness.editor.undo();
			expect(read(harness)).toEqual(before);
		});

		it('aligns several to the bottom of the bounds they cover', () => {
			const harness = severalSelected();

			harness.editor.align('bottom');

			expect(SELECTED.map(id => rect(harness, id)?.y)).toEqual([600, 600, 600]);
		});

		it('aligns one layer to the canvas, and writes nothing when none would move', () => {
			const harness = editing();

			harness.editor.align('left');
			harness.editor.align('left');

			expect(rect(harness, 'a')?.x).toBe(0);
			expect(harness.writes).toHaveLength(1);
		});

		it.each<[string, (harness: Editing) => void, [boolean, boolean]]>([
			[
				'none',
				harness => harness.editor.select({ type: 'canvas' }),
				[false, false],
			],
			[
				'one',
				() => {},
				[true, false],
			],
			[
				'three',
				(harness) => {
					harness.editor.toggleSelect(harness.layer('b'));
					harness.editor.toggleSelect(harness.layer('c'));
				},
				[true, true],
			],
		])('offers align and distribute to %s selected', (_, selecting, offered) => {
			const harness = editing();
			selecting(harness);

			expect([
				harness.editor.canAlign(),
				harness.editor.canDistribute(),
			]).toEqual(offered);
		});
	});

	/** The clipboard module owns the paste rules; the editor selects the copies and records one step. */
	describe('copying and pasting', () => {
		it('pastes copied layers as one undo step, selecting the copies', () => {
			const harness = editing();
			harness.editor.toggleSelect(harness.layer('b'));
			const copied = harness.editor.copy()!;
			const before = JSON.parse(JSON.stringify(harness.composition()));

			expect(harness.editor.paste(copied)).toBeNull();

			expect(harness.writes).toHaveLength(1);
			expect(harness.editor.layers.value).toHaveLength(2);
			expect(harness.editor.layers.value).not.toContainEqual(harness.layer('a'));
			expect(harness.composition().items).toHaveLength(before.items.length + 2);
			harness.editor.undo();
			expect(harness.composition()).toEqual(before);
		});

		it('pastes a style onto every selected Graphic Item it fits, as one undo step', () => {
			const panel = surfaceStyle({
				fill: { type: 'solid', color: '#ff0000' },
			});
			const harness = editing(true, [
				text('from', { surfaceStyle: panel }),
				shape('fits', {
					themeBindings: { surfaceStyle: 'panel' },
				}),
				media('does-not'),
			]);
			harness.editor.select(harness.layer('from'));
			const copied = harness.editor.copyStyle()!;
			harness.editor.select(harness.layer('fits'));
			harness.editor.toggleSelect(harness.layer('does-not'));

			expect(harness.editor.pasteStyle(copied)).toBeNull();

			expect(harness.writes).toHaveLength(1);
			expect(harness.composition().items.map(item => 'surfaceStyle' in item && item.surfaceStyle)).toEqual([panel, panel, false]);
			expect(harness.composition().items[1]).not.toHaveProperty('themeBindings');
		});

		it('refuses layers copied from another host, writing nothing', () => {
			const harness = editing();
			const copied = harness.editor.copy()!;

			const refusal = harness.editor.paste({
				...copied,
				host: copied.host === 'broadcast-graphics'
					? 'feature-match-overlay'
					: 'broadcast-graphics',
			});

			expect(refusal).toMatchObject({ reason: 'other-host' });
			expect(harness.writes).toEqual([]);
		});
	});
});

/** The Feature Match Overlay's own layers, the Source Items, through the shared verbs. */
describe('the shared graphics editor\'s Source Items on the Feature Match Overlay', () => {
	const SOURCE = { type: 'source', itemId: 'main-source' } as const;
	const OTHER_SOURCE = { type: 'source', itemId: 'player1-source' } as const;

	function sourceAt(harness: ReturnType<typeof featureMatchLayoutEditing>, id: string) {
		const source = harness.document().sources.find(item => item.id === id);
		return source && { x: source.x, y: source.y, locked: source.locked };
	}

	it('adds a Source Item as one undo step, and selects it', () => {
		const harness = featureMatchLayoutEditing({ writable: true });
		const before = harness.document().sources.length;

		harness.editor.addHostLayer();

		expect(harness.document().sources).toHaveLength(before + 1);
		expect(harness.editor.layers.value).toEqual([
			{ type: 'source', itemId: harness.document().sources.at(-1)!.id },
		]);
		harness.editor.undo();
		expect(harness.document().sources).toHaveLength(before);
	});

	it('moves a Source Item and a Graphic Item together on the canvas', () => {
		const harness = featureMatchLayoutEditing({
			writable: true,
			items: items(),
		});
		harness.editor.select(SOURCE);
		harness.editor.toggleSelect({ type: 'item', itemId: 'a' });
		const before = sourceAt(harness, 'main-source')!;

		harness.editor.nudge({ x: 3, y: 0 });

		expect([sourceAt(harness, 'main-source')?.x, findGraphicItem(harness.composition(), 'a')?.item.x]).toEqual([before.x + 3, 13]);
		expect(harness.writes).toHaveLength(1);
	});

	it('locks a Source Item and stores it unlocked again as one never locked', () => {
		const harness = featureMatchLayoutEditing({ writable: true });
		harness.editor.select(SOURCE);

		harness.editor.toggleLock();
		expect(sourceAt(harness, 'main-source')?.locked).toBe(true);
		harness.editor.toggleLock();
		expect(harness.document().sources[0]).not.toHaveProperty('locked');
	});

	it('refuses to group a selection holding a Source Item', () => {
		const harness = featureMatchLayoutEditing({
			writable: true,
			items: items(),
		});
		harness.editor.select({ type: 'item', itemId: 'a' });
		harness.editor.toggleSelect({ type: 'item', itemId: 'b' });
		harness.editor.toggleSelect(SOURCE);

		harness.editor.group();

		expect(harness.editor.groupRefusal.value).toBe('source-item');
		expect(harness.writes).toEqual([]);
	});

	it('reorders a Source Item among the Source Items only', () => {
		const harness = featureMatchLayoutEditing({ writable: true });
		const order = harness.document().sources.map(source => source.id);

		harness.editor.moveToEdge(SOURCE, 'front');

		expect(harness.document().sources.map(source => source.id)).toEqual([
			...order.filter(id => id !== 'main-source'),
			'main-source',
		]);
	});

	it('copies and pastes a Source Item with the Graphic Items, selecting both copies', () => {
		const harness = featureMatchLayoutEditing({
			writable: true,
			items: items(),
		});
		harness.editor.select({ type: 'item', itemId: 'a' });
		harness.editor.toggleSelect(OTHER_SOURCE);

		expect(harness.editor.paste(harness.editor.copy()!)).toBeNull();

		expect(harness.editor.layers.value.map(layer => layer.type)).toEqual(['item', 'source']);
	});
});

/** Broadcast Graphics' own rules: several Broadcast Graphics, one of them perhaps on air. */
describe('the shared graphics editor\'s Broadcast Graphics', () => {
	function editing() {
		const harness = broadcastGraphicsEditing({
			writable: true,
			items: items(),
		});
		harness.editor.select(harness.layer('a'));
		return harness;
	}

	const SLATE_ITEM = { type: 'item', graphicId: OTHER_GRAPHIC_ID, itemId: 's' } as const;

	// An edit to a graphic on a program output would reach program at once.
	it('refuses an edit to a Broadcast Graphic on air, and its undo leaves it as it is', () => {
		const harness = editing();
		harness.editor.toggleVisible();
		harness.editor.nudge({ x: 5, y: 0 });
		harness.onAir.value = new Set([EDITED_GRAPHIC_ID]);
		const onAir = harness.graphic(EDITED_GRAPHIC_ID);
		const writes = harness.writes.length;

		harness.editor.nudge({ x: 5, y: 0 });
		harness.editor.edit(harness.document().map(graphic => graphic.id === EDITED_GRAPHIC_ID
			? { ...graphic, name: 'Renamed' }
			: graphic));
		expect(harness.writes).toHaveLength(writes);

		harness.editor.select(SLATE_ITEM);
		harness.editor.toggleVisible();
		harness.editor.undo();
		harness.editor.undo();
		expect(harness.graphic(EDITED_GRAPHIC_ID)).toEqual(onAir);
		expect(findGraphicItem(harness.graphic(OTHER_GRAPHIC_ID), 's')?.item.visible).toBe(true);
	});

	// Undo covers the item tree; a Graphic Channel assignment is made outside it.
	it('keeps the Graphic Channel each graphic is in now through an undo', () => {
		const harness = editing();
		harness.editor.toggleVisible();
		harness.channels.value = [
			{ id: 'thirds', name: 'Lower thirds' },
		];
		harness.graphics.value = harness.graphics.value.map(graphic => ({ ...graphic, channelId: 'thirds' }));

		harness.editor.undo();

		expect(rect(harness, 'a')?.visible).toBe(true);
		expect(harness.document().map(graphic => graphic.channelId)).toEqual(['thirds', 'thirds']);
	});

	// Align, group and paste act within one composition.
	it.each<[string, (harness: ReturnType<typeof editing>) => void]>([
		[
			'⌘-click',
			harness => harness.editor.toggleSelect(SLATE_ITEM),
		],
		[
			'Shift-click',
			harness => harness.editor.extendSelect(SLATE_ITEM),
		],
	])('selects layers of one Broadcast Graphic at a time on %s', (_, selecting) => {
		const harness = editing();

		selecting(harness);

		expect(harness.editor.layers.value).toEqual([SLATE_ITEM]);
	});

	it('adds a Graphic Item to the selected Broadcast Graphic when no layer is selected', () => {
		const harness = editing();
		harness.editor.select({ type: 'canvas' });
		harness.selectedGraphicId.value = OTHER_GRAPHIC_ID;

		harness.editor.addItem('shape');

		expect(harness.graphic(OTHER_GRAPHIC_ID).items.map(item => item.type)).toEqual(['text', 'shape']);
		expect(harness.editor.layers.value).toEqual([
			{ type: 'item', graphicId: OTHER_GRAPHIC_ID, itemId: harness.graphic(OTHER_GRAPHIC_ID).items[1]!.id },
		]);
	});
});
