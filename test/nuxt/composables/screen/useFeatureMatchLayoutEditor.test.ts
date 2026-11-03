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
	])('writes nothing on %s', async (_, verb) => {
		const { editor, writes } = editorFor(false);

		verb(editor);
		await nextTick();

		expect(writes).toEqual([]);
		expect(editor.canUndo.value).toBe(false);
		expect(editor.selection.value).toEqual(SOURCE);
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
