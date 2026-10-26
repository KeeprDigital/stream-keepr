import type { BroadcastGraphicConfig, GraphicItemKind, GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { EditHistory } from '~/modules/feature-match-overlay/editHistory';
import type { FeatureMatchLayoutEditorSelection } from '~/modules/feature-match-overlay/editorSelection';
import {
	addGraphicGroupChild,
	addGraphicItem,
	deleteGraphicItem,
	duplicateGraphicItem,
	findGraphicItem,
	moveGraphicItem,
	moveGraphicItemToEdge,
	patchGraphicItem,
} from '~~/shared/modules/graphics';
import { randomUuid } from '~~/shared/utils/uuid';
import { emptyEditHistory, recordEdit, redoEdit, undoEdit } from '~/modules/feature-match-overlay/editHistory';
import { CANVAS_SELECTION, editorSelectionExists, editorSelectionFrame, editorSelectionLabel } from '~/modules/feature-match-overlay/editorSelection';
import * as layoutWriter from '~/modules/feature-match-overlay/layout';
import { nudgeRect } from '~/modules/graphics/canvasManipulation';

/** What one undo step restores: the authored layout and the preset it started from. */
interface LayoutSnapshot {
	layout: FeatureMatchOverlayModeConfig['layout'];
	presetId: FeatureMatchOverlayModeConfig['presetId'];
}

/** The fields every layer has, Source Item and Graphic Item alike. */
type LayerPatch = Partial<GraphicRect> & { label?: string; visible?: boolean };

export interface FeatureMatchLayoutEditOptions {
	/**
	 * Edits sharing a key within a moment of each other undo as one step: the
	 * frames of one drag, the keystrokes of one field. Structural edits pass none.
	 */
	coalesce?: string;
}

interface FeatureMatchLayoutEditorOptions {
	config: Ref<FeatureMatchOverlayModeConfig>;
	updateConfig: (partial: Partial<FeatureMatchOverlayModeConfig>) => void;
	canvasWidth: MaybeRefOrGetter<number>;
	canvasHeight: MaybeRefOrGetter<number>;
}

/**
 * The Feature Match Overlay editor's verbs, over its one selection and its undo
 * history.
 *
 * Every layout write the editor makes goes through `edit`, which records the
 * state it replaces, so the layer list, the property panel, the canvas, and the
 * keyboard all undo alike. The Feature Match Slot and the canvas size are what
 * the Screen points at and how big it is, not authored layout, so neither is
 * recorded.
 *
 * The selection follows each structural edit — an added or duplicated layer is
 * selected, a removed one gives way to the canvas — and falls back to the canvas
 * whenever what it names leaves the layout, whoever removed it.
 */
export function useFeatureMatchLayoutEditor(options: FeatureMatchLayoutEditorOptions) {
	const { config, updateConfig } = options;

	const selection = ref<FeatureMatchLayoutEditorSelection>(CANVAS_SELECTION);
	const history = shallowRef<EditHistory<LayoutSnapshot>>(emptyEditHistory());

	const canUndo = computed(() => history.value.past.length > 0);
	const canRedo = computed(() => history.value.future.length > 0);

	function snapshot(): LayoutSnapshot {
		return JSON.parse(JSON.stringify({ layout: config.value.layout, presetId: config.value.presetId }));
	}

	function select(next: FeatureMatchLayoutEditorSelection) {
		selection.value = next;
	}

	watch(() => config.value.layout, (layout) => {
		if (!editorSelectionExists(layout, selection.value))
			selection.value = CANVAS_SELECTION;
	});

	/** Record the current layout as an undo step, without writing anything. */
	function checkpoint(edit: FeatureMatchLayoutEditOptions = {}) {
		history.value = recordEdit(history.value, snapshot(), {
			now: Date.now(),
			key: edit.coalesce,
		});
	}

	/** Write part of the mode config as one undoable edit. */
	function edit(partial: Partial<FeatureMatchOverlayModeConfig>, editOptions: FeatureMatchLayoutEditOptions = {}) {
		checkpoint(editOptions);
		updateConfig(partial);
	}

	/** Field edits from the property panels: one undo step per burst of typing. */
	function editFields(partial: Partial<FeatureMatchOverlayModeConfig>) {
		edit(partial, { coalesce: 'fields' });
	}

	function restore(next: LayoutSnapshot) {
		updateConfig({ layout: next.layout, presetId: next.presetId });
	}

	function undo() {
		const step = undoEdit(history.value, snapshot());
		if (!step)
			return;
		history.value = step.history;
		restore(step.restore);
	}

	/**
	 * Forget every undo and redo step. Called when someone else changes the layout:
	 * a step recorded before their change would put back a whole layout without it.
	 * Answers whether there was anything to forget.
	 */
	function discardHistory(): boolean {
		const had = canUndo.value || canRedo.value;
		history.value = emptyEditHistory();
		return had;
	}

	function redo() {
		const step = redoEdit(history.value, snapshot());
		if (!step)
			return;
		history.value = step.history;
		restore(step.restore);
	}

	/* ── Graphic Items ─────────────────────────────── */

	function editComposition(
		apply: (composition: BroadcastGraphicConfig) => BroadcastGraphicConfig,
		editOptions: FeatureMatchLayoutEditOptions = {},
	): boolean {
		const current = config.value.layout.composition;
		const composition = apply(current);
		if (composition === current)
			return false;
		edit({
			layout: { ...config.value.layout, composition },
		}, editOptions);
		return true;
	}

	function addItem(kind: GraphicItemKind) {
		const itemId = randomUuid();
		if (editComposition(composition => addGraphicItem(composition, {
			kind,
			id: itemId,
			canvasWidth: toValue(options.canvasWidth),
			canvasHeight: toValue(options.canvasHeight),
		}).graphic)) {
			select({ type: 'item', itemId });
		}
	}

	/** The Graphic Group the selection is, or sits in. */
	const selectedGroup = computed(() => {
		const current = selection.value;
		if (current.type !== 'item')
			return null;
		const location = findGraphicItem(config.value.layout.composition, current.itemId);
		if (location?.group)
			return location.group;
		return location?.item.type === 'group'
			? location.item
			: null;
	});

	function addGroupChild(kind: Exclude<GraphicItemKind, 'group'>) {
		const group = selectedGroup.value;
		if (!group)
			return;
		const itemId = randomUuid();
		if (editComposition(composition => addGraphicGroupChild(composition, { kind, groupId: group.id, id: itemId }).graphic))
			select({ type: 'item', itemId });
	}

	/* ── Source Items ──────────────────────────────── */

	function editLayout(
		apply: (layout: FeatureMatchOverlayModeConfig['layout']) => FeatureMatchOverlayModeConfig['layout'],
		editOptions: FeatureMatchLayoutEditOptions = {},
	): boolean {
		const current = config.value.layout;
		const layout = apply(current);
		if (layout === current)
			return false;
		edit({ layout }, editOptions);
		return true;
	}

	function addSource() {
		const { layout, id } = layoutWriter.createSourceItem(config.value.layout);
		edit({ layout });
		select({ type: 'source', itemId: id });
	}

	/* ── Either kind of layer ──────────────────────── */

	function remove(target: FeatureMatchLayoutEditorSelection = selection.value) {
		if (target.type === 'canvas')
			return;
		const removed = target.type === 'source'
			? editLayout(layout => layoutWriter.removeSource(layout, target.itemId))
			: editComposition(composition => deleteGraphicItem(composition, target.itemId));
		if (removed)
			select(CANVAS_SELECTION);
	}

	function duplicate(target: FeatureMatchLayoutEditorSelection = selection.value) {
		if (target.type === 'source') {
			const { layout, id } = layoutWriter.duplicateSource(config.value.layout, target.itemId);
			if (id) {
				edit({ layout });
				select({ type: 'source', itemId: id });
			}
			return;
		}
		if (target.type === 'item') {
			let copyId = '';
			if (editComposition((composition) => {
				const result = duplicateGraphicItem(composition, target.itemId, { nextId: randomUuid });
				copyId = result.itemId;
				return result.graphic;
			})) {
				select({ type: 'item', itemId: copyId });
			}
		}
	}

	/** Move one layer a step toward the front (+1) or the back (-1) of its own list. */
	function move(target: FeatureMatchLayoutEditorSelection, delta: 1 | -1) {
		if (target.type === 'source')
			editLayout(layout => layoutWriter.moveSourceOrder(layout, target.itemId, delta));
		else if (target.type === 'item')
			editComposition(composition => moveGraphicItem(composition, target.itemId, delta));
	}

	function moveToEdge(target: FeatureMatchLayoutEditorSelection, edge: 'front' | 'back') {
		if (target.type === 'source') {
			editLayout(layout => edge === 'front'
				? layoutWriter.bringSourceToFront(layout, target.itemId)
				: layoutWriter.sendSourceToBack(layout, target.itemId));
		}
		else if (target.type === 'item') {
			editComposition(composition => moveGraphicItemToEdge(composition, target.itemId, edge));
		}
	}

	function isVisible(target: FeatureMatchLayoutEditorSelection): boolean {
		if (target.type === 'source')
			return config.value.layout.sources.find(item => item.id === target.itemId)?.visible !== false;
		if (target.type === 'item')
			return findGraphicItem(config.value.layout.composition, target.itemId)?.item.visible !== false;
		return true;
	}

	/**
	 * Patch what a Source Item and a Graphic Item both have, through each kind's
	 * own write: the Source Item list's, or the composition's.
	 */
	function patchLayer(target: FeatureMatchLayoutEditorSelection, patch: LayerPatch, editOptions: FeatureMatchLayoutEditOptions = {}) {
		if (target.type === 'source')
			editLayout(layout => layoutWriter.patchSource(layout, target.itemId, patch), editOptions);
		else if (target.type === 'item')
			editComposition(composition => patchGraphicItem(composition, target.itemId, patch), editOptions);
	}

	function toggleVisible(target: FeatureMatchLayoutEditorSelection = selection.value) {
		patchLayer(target, { visible: !isVisible(target) });
	}

	/**
	 * Rename a layer as one undo step of its own, through the writes its property
	 * panel's name field uses. Unlike that field, which writes as the author types,
	 * this takes a finished name: trimmed, and a blank one, or the name the layer
	 * already has, writes nothing.
	 */
	function rename(target: FeatureMatchLayoutEditorSelection, name: string) {
		const label = name.trim();
		const current = editorSelectionLabel(config.value.layout, target);
		if (label !== '' && current !== undefined && label !== current)
			patchLayer(target, { label });
	}

	/** Set a layer's stored rectangle, as the canvas moves or resizes it. */
	function setRect(target: FeatureMatchLayoutEditorSelection, rect: GraphicRect, editOptions: FeatureMatchLayoutEditOptions = {}) {
		patchLayer(target, rect, editOptions);
	}

	function nudge(delta: { x: number; y: number }) {
		const target = selection.value;
		const frame = editorSelectionFrame(config.value.layout, target);
		if (frame) {
			setRect(target, nudgeRect(frame.rect, delta), { coalesce: `nudge:${target.type}:${'itemId' in target
				? target.itemId
				: ''}` });
		}
	}

	return {
		selection,
		select,
		selectedGroup,
		canUndo,
		canRedo,
		checkpoint,
		discardHistory,
		edit,
		editFields,
		undo,
		redo,
		addItem,
		addGroupChild,
		addSource,
		remove,
		duplicate,
		move,
		moveToEdge,
		isVisible,
		toggleVisible,
		rename,
		setRect,
		nudge,
	};
}

export type FeatureMatchLayoutEditor = ReturnType<typeof useFeatureMatchLayoutEditor>;
