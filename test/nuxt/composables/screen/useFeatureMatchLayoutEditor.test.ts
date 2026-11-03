import type { FeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';
import { describe, expect, it, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '~~/shared/types/screenConfig';
import { useFeatureMatchLayoutEditor } from '~/composables/screen/useFeatureMatchLayoutEditor';

/**
 * The editor writes the Feature Match Layout only while its session holds the
 * Graphics Authoring Lease (#738), and forgets its undo history on losing it.
 */

const SOURCE = { type: 'source', itemId: 'main-source' } as const;
const OTHER_SOURCE = { type: 'source', itemId: 'player1-source' } as const;
const ITEM = { type: 'item', itemId: 'player1-game-wins' } as const;
/** The backmost Graphic Item, which a reorder can bring forward. */
const firstItemId = DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.composition.items[0]!.id;

function editorFor(writable: boolean) {
	const config = ref(structuredClone(DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG));
	const writes: unknown[] = [];
	const leased = ref(writable);
	const editor = useFeatureMatchLayoutEditor({
		config,
		updateConfig: (patch) => {
			writes.push(patch);
			config.value = {
				...config.value,
				...patch,
			};
		},
		canvasWidth: 1920,
		canvasHeight: 1080,
		writable: leased,
	});
	editor.select(SOURCE);
	return { editor, writes, leased, config };
}

describe('useFeatureMatchLayoutEditor without the lease', () => {
	it.each<[string, (editor: FeatureMatchLayoutEditor) => void]>([
		[
			'edit',
			editor => editor.editFields({ presetId: 'full-table' }),
		],
		[
			'add a Graphic Item',
			editor => editor.addItem('text'),
		],
		[
			'add a Source Item',
			editor => editor.addSource(),
		],
		[
			'remove',
			editor => editor.remove(),
		],
		[
			'duplicate',
			editor => editor.duplicate(),
		],
		[
			'reorder',
			editor => editor.moveToEdge({ type: 'item', itemId: firstItemId }, 'front'),
		],
		[
			'hide',
			editor => editor.toggleVisible(),
		],
		[
			'rename',
			editor => editor.rename(SOURCE, 'Renamed'),
		],
		[
			'move on the canvas',
			editor => editor.setRect(SOURCE, { x: 1, y: 2, width: 3, height: 4 }),
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
			'move several on the canvas',
			(editor) => {
				editor.toggleSelect(ITEM);
				editor.setSelectionRect({ x: 0, y: 0, width: 1, height: 1 });
			},
		],
		[
			'edit several layers\' shared geometry',
			(editor) => {
				editor.toggleSelect(ITEM);
				editor.setLayersGeometry({ x: 5 });
			},
		],
	])('writes nothing on %s', async (_, verb) => {
		const { editor, writes } = editorFor(false);

		verb(editor);
		await nextTick();

		expect(writes).toEqual([]);
		expect(editor.canUndo.value).toBe(false);
		expect(editor.layers.value[0]).toEqual(SOURCE);
	});

	it('clears undo and redo history on losing the lease, and does not restore it on regaining it', async () => {
		const { editor, leased } = editorFor(true);
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

	it('writes once the lease is held', () => {
		const { editor, writes, config } = editorFor(true);

		editor.toggleVisible();

		expect(writes).toHaveLength(1);
		expect(config.value.layout.sources.find(item => item.id === 'main-source')?.visible).toBe(false);
	});
});

describe('useFeatureMatchLayoutEditor gestures', () => {
	it('undoes a gesture as one step however long it pauses, and joins it to no edit around it', () => {
		const clock = { now: 1_000 };
		vi.spyOn(Date, 'now').mockImplementation(() => clock.now);
		const { editor, config } = editorFor(true);
		const opacity = () => config.value.layout.frame.opacity;
		/** Frame opacity edits from a property panel, `msApart` from each other. */
		function editOpacities(opacities: number[], msApart: number) {
			for (const next of opacities) {
				clock.now += msApart;
				editor.editFields({
					layout: {
						...config.value.layout,
						frame: { ...config.value.layout.frame, opacity: next },
					},
				});
			}
		}

		editOpacities([0.9], 10);
		editor.beginGesture();
		editOpacities([0.8, 0.7, 0.6], 2_000);
		editor.endGesture();
		editOpacities([0.5], 10);

		const undone = [
			opacity(),
		];
		while (editor.canUndo.value) {
			editor.undo();
			undone.push(opacity());
		}
		expect(undone).toEqual([
			0.5,
			0.6,
			0.9,
			DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG.layout.frame.opacity,
		]);
	});
});

/** Several layers selected act together, each verb one undo step (#740). */
describe('useFeatureMatchLayoutEditor with several layers selected', () => {
	function severalSelected() {
		const editing = editorFor(true);
		editing.editor.toggleSelect(OTHER_SOURCE);
		editing.editor.toggleSelect(ITEM);
		return editing;
	}

	function rectOf(config: ReturnType<typeof editorFor>['config'], layer: { type: string; itemId: string }) {
		const found = layer.type === 'source'
			? config.value.layout.sources.find(item => item.id === layer.itemId)
			: config.value.layout.composition.items.find(item => item.id === layer.itemId);
		return found && {
			x: found.x,
			y: found.y,
			width: found.width,
			height: found.height,
			visible: found.visible,
		};
	}

	const SELECTED = [SOURCE, OTHER_SOURCE, ITEM];

	// They cover (24, 16) to (1900, 990).
	it.each<[string, (editor: FeatureMatchLayoutEditor) => void, { x: number; y: number }]>([
		[
			'a canvas drag of the box they cover, over two frames of one gesture',
			(editor) => {
				editor.setSelectionRect({
					x: 30,
					y: 14,
					width: 1876,
					height: 974,
				}, { coalesce: 'canvas:1' });
				editor.setSelectionRect({
					x: 34,
					y: 11,
					width: 1876,
					height: 974,
				}, { coalesce: 'canvas:1' });
			},
			{ x: 10, y: -5 },
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
		const { editor, config } = severalSelected();
		const before = SELECTED.map(layer => rectOf(config, layer));

		gesture(editor);

		expect(SELECTED.map(layer => rectOf(config, layer))).toEqual(before.map(rect => ({ ...rect, x: rect!.x + delta.x, y: rect!.y + delta.y })));
		editor.undo();
		expect(SELECTED.map(layer => rectOf(config, layer))).toEqual(before);
		expect(editor.canUndo.value).toBe(false);
	});

	it.each<[string, (editor: FeatureMatchLayoutEditor) => void, (config: ReturnType<typeof editorFor>['config']) => unknown]>([
		[
			'deletes every one',
			editor => editor.remove(),
			config => SELECTED.map(layer => rectOf(config, layer)),
		],
		[
			'hides every one',
			editor => editor.toggleVisible(),
			config => SELECTED.map(layer => rectOf(config, layer)?.visible),
		],
		[
			'duplicates every one',
			editor => editor.duplicate(),
			config => [config.value.layout.sources.length, config.value.layout.composition.items.length],
		],
		[
			'writes shared geometry to every one',
			editor => editor.setLayersGeometry({ x: 5, height: 60 }),
			config => SELECTED.map(layer => rectOf(config, layer)),
		],
	])('%s as one undo step', (_, verb, read) => {
		const { editor, config, writes } = severalSelected();
		const before = read(config);

		verb(editor);

		expect(writes).toHaveLength(1);
		expect(read(config)).not.toEqual(before);
		editor.undo();
		expect(read(config)).toEqual(before);
	});

	it('hides every one while any shows, and shows them all once all are hidden', () => {
		const { editor, config } = severalSelected();
		editor.toggleVisible(ITEM);

		editor.toggleVisible();
		expect(SELECTED.map(layer => rectOf(config, layer)?.visible)).toEqual([false, false, false]);
		editor.toggleVisible();
		expect(SELECTED.map(layer => rectOf(config, layer)?.visible)).toEqual([true, true, true]);
	});

	it('selects the copies after duplicating, and nothing after deleting', () => {
		const { editor, config } = severalSelected();
		const sourceIds = config.value.layout.sources.map(item => item.id);

		editor.duplicate();
		expect(editor.layers.value).toHaveLength(3);
		expect(editor.layers.value.every(layer => layer.itemId !== ITEM.itemId && !sourceIds.includes(layer.itemId))).toBe(true);

		editor.remove();
		expect(editor.layers.value).toEqual([]);
		expect(editor.selection.value).toEqual({ type: 'canvas' });
	});

	it('acts with a single-layer verb on none of them, since no one layer is the selection', () => {
		const { editor, config } = severalSelected();
		const order = config.value.layout.sources.map(item => item.id);

		editor.moveToEdge(editor.selection.value, 'front');

		expect(editor.selection.value).toEqual({ type: 'canvas' });
		expect(config.value.layout.sources.map(item => item.id)).toEqual(order);
	});

	it('lets go of a layer someone else removes, keeping the rest', async () => {
		const { editor, config } = severalSelected();

		config.value = {
			...config.value,
			layout: {
				...config.value.layout,
				sources: config.value.layout.sources.filter(item => item.id !== OTHER_SOURCE.itemId),
			},
		};
		await nextTick();

		expect(editor.layers.value).toEqual([SOURCE, ITEM]);
	});
});

/** ⌘G and ⌘⇧G, each one undo step that only a leaseholder writes (#920). */
describe('useFeatureMatchLayoutEditor grouping and ungrouping', () => {
	const WINS = [
		ITEM,
		{ type: 'item', itemId: 'player2-game-wins' },
	] as const;
	const TOP_BAR = { type: 'item', itemId: 'top-bar' } as const;

	function topLevelIds(config: ReturnType<typeof editorFor>['config']) {
		return config.value.layout.composition.items.map(item => item.id);
	}

	function selectWins(editor: FeatureMatchLayoutEditor) {
		editor.select(WINS[0]);
		editor.toggleSelect(WINS[1]);
	}

	it('groups the selected Graphic Items as one undo step, and selects the new group', () => {
		const { editor, config, writes } = editorFor(true);
		selectWins(editor);
		const before = topLevelIds(config);

		editor.group();

		expect(writes).toHaveLength(1);
		const created = config.value.layout.composition.items.find(item => !before.includes(item.id));
		expect(created?.type === 'group' && created.children.map(child => child.id)).toEqual(['player1-game-wins', 'player2-game-wins']);
		expect(editor.layers.value).toEqual([
			{ type: 'item', itemId: created!.id },
		]);
		editor.undo();
		expect(topLevelIds(config)).toEqual(before);
	});

	it('ungroups the selected group as one undo step, and selects its former children', () => {
		const { editor, config, writes } = editorFor(true);
		editor.select(TOP_BAR);
		const before = topLevelIds(config);

		editor.ungroup();

		expect(writes).toHaveLength(1);
		expect(topLevelIds(config)).not.toContain('top-bar');
		expect(editor.layers.value.map(layer => layer.itemId)).toContain('top-name-record');
		editor.undo();
		expect(topLevelIds(config)).toEqual(before);
	});

	it.each<[string, boolean, (editor: FeatureMatchLayoutEditor) => void]>([
		[
			'grouping a selection holding a Source Item',
			true,
			(editor) => {
				editor.toggleSelect(WINS[0]);
				editor.toggleSelect(WINS[1]);
				editor.group();
			},
		],
		[
			'grouping without the lease',
			false,
			(editor) => {
				selectWins(editor);
				editor.group();
			},
		],
		[
			'ungrouping without the lease',
			false,
			(editor) => {
				editor.select(TOP_BAR);
				editor.ungroup();
			},
		],
		[
			'ungrouping a layer that is not a group',
			true,
			(editor) => {
				editor.select(ITEM);
				editor.ungroup();
			},
		],
	])('writes nothing %s', (_, writable, verb) => {
		const { editor, writes } = editorFor(writable);

		verb(editor);

		expect(writes).toEqual([]);
	});
});
