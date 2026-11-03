import type { BroadcastGraphicConfig, GraphicItemKind, GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { EditHistory } from '~/modules/feature-match-overlay/editHistory';
import type { FeatureMatchLayoutEditorLayer, FeatureMatchLayoutEditorSelection } from '~/modules/feature-match-overlay/editorSelection';
import type { LayerSelection } from '~/modules/feature-match-overlay/layerSelection';
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
import { CANVAS_SELECTION, editorLayersFrame, editorSelectionKey, editorSelectionLabel, editorSelectionLayer } from '~/modules/feature-match-overlay/editorSelection';
import {
	collapseLayerSelection,
	extendLayerSelection,
	NO_LAYERS,
	onlyLayer,
	pruneLayerSelection,
	toggleLayer,
} from '~/modules/feature-match-overlay/layerSelection';
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
	/**
	 * Whether this session holds the Screen's Graphics Authoring Lease (#738).
	 * Required, so an editor that forgot the lease cannot write.
	 */
	writable: MaybeRefOrGetter<boolean>;
}

/**
 * The Feature Match Overlay editor's verbs, over its selection and its undo
 * history.
 *
 * Every layout write the editor makes goes through `edit`, which records the
 * state it replaces, so the layer list, the property panel, the canvas, and the
 * keyboard all undo alike. The Feature Match Slot and the canvas size are what
 * the Screen points at and how big it is, not authored layout, so neither is
 * recorded.
 *
 * The selection is none, one or several layers (#740). `selection` names its one
 * layer, or the canvas with none or several, so a verb aimed at one layer never
 * picks one of several. Delete, duplicate, hide, nudge and a canvas move act on
 * every selected layer, each as one undo step.
 *
 * The selection follows each structural edit — an added or duplicated layer is
 * selected, a removed one gives way to the canvas — and lets go of a layer
 * whenever it leaves the layout, whoever removed it.
 *
 * Only a session holding the Graphics Authoring Lease writes (#738): without it
 * every verb writes and records nothing, and losing it ends the undo history,
 * since the next holder's changes would be undone over.
 */
export function useFeatureMatchLayoutEditor(options: FeatureMatchLayoutEditorOptions) {
	const { config, updateConfig } = options;
	const writable = computed(() => toValue(options.writable));

	const layerSelection = shallowRef<LayerSelection>(NO_LAYERS);
	/** Every selected layer, in the order the author chose them. */
	const layers = computed(() => layerSelection.value.layers);
	/** The layer the author chose last: the one the layer list keeps in view. */
	const anchor = computed(() => layerSelection.value.anchor);
	/** The one selected layer, or the canvas with none or several. */
	const selection = computed<FeatureMatchLayoutEditorSelection>(() => layers.value.length === 1
		? layers.value[0]!
		: CANVAS_SELECTION);
	const history = shallowRef<EditHistory<LayoutSnapshot>>(emptyEditHistory());

	const canUndo = computed(() => writable.value && history.value.past.length > 0);
	const canRedo = computed(() => writable.value && history.value.future.length > 0);

	watch(writable, (isWritable) => {
		if (!isWritable)
			history.value = emptyEditHistory();
	});

	function snapshot(): LayoutSnapshot {
		return JSON.parse(JSON.stringify({ layout: config.value.layout, presetId: config.value.presetId }));
	}

	/** Select one layer, or none with the canvas. */
	function select(next: FeatureMatchLayoutEditorSelection) {
		layerSelection.value = next.type === 'canvas'
			? NO_LAYERS
			: onlyLayer(next);
	}

	/** ⌘-click: add a layer to the selection, or take it out. */
	function toggleSelect(layer: FeatureMatchLayoutEditorLayer) {
		layerSelection.value = toggleLayer(config.value.layout, layerSelection.value, layer);
	}

	/** Shift-click: select the layer list's run from the anchor to this layer. */
	function extendSelect(layer: FeatureMatchLayoutEditorLayer) {
		layerSelection.value = extendLayerSelection(config.value.layout, layerSelection.value, layer);
	}

	/** Escape: several layers to the one chosen last, one to none. */
	function collapseSelection() {
		layerSelection.value = collapseLayerSelection(layerSelection.value);
	}

	watch(() => config.value.layout, (layout) => {
		layerSelection.value = pruneLayerSelection(layout, layerSelection.value);
	});

	/** Record the current layout as an undo step, without writing anything. */
	function checkpoint(edit: FeatureMatchLayoutEditOptions = {}) {
		if (!writable.value)
			return;
		history.value = recordEdit(history.value, snapshot(), {
			now: Date.now(),
			key: edit.coalesce,
		});
	}

	/**
	 * Write part of the mode config as one undoable edit: the one write every verb
	 * takes. Answers whether it wrote, which it does only while leased.
	 */
	function edit(partial: Partial<FeatureMatchOverlayModeConfig>, editOptions: FeatureMatchLayoutEditOptions = {}): boolean {
		if (!writable.value)
			return false;
		checkpoint(editOptions);
		updateConfig(partial);
		return true;
	}

	/** Field edits from the property panels: one undo step per burst of typing. */
	function editFields(partial: Partial<FeatureMatchOverlayModeConfig>) {
		edit(partial, { coalesce: 'fields' });
	}

	function restore(next: LayoutSnapshot) {
		updateConfig({ layout: next.layout, presetId: next.presetId });
	}

	function undo() {
		if (!canUndo.value)
			return;
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
		if (!canRedo.value)
			return;
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
		return edit({
			layout: { ...config.value.layout, composition },
		}, editOptions);
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
		return edit({ layout }, editOptions);
	}

	function addSource() {
		const { layout, id } = layoutWriter.createSourceItem(config.value.layout);
		if (edit({ layout }))
			select({ type: 'source', itemId: id });
	}

	/* ── Either kind of layer ──────────────────────── */

	/** The layers a verb acts on: the one it names, or every selected layer. */
	function targets(target?: FeatureMatchLayoutEditorSelection): FeatureMatchLayoutEditorLayer[] {
		if (target) {
			return target.type === 'canvas'
				? []
				: [target];
		}
		return [...layers.value];
	}

	/** Remove a layer, or every selected layer as one undo step. */
	function remove(target?: FeatureMatchLayoutEditorSelection) {
		const removing = targets(target);
		const removed = removing.length > 0 && editLayout(layout => removing.reduce((next, layer) => {
			if (layer.type === 'source')
				return layoutWriter.removeSource(next, layer.itemId);
			const composition = deleteGraphicItem(next.composition, layer.itemId);
			return composition === next.composition
				? next
				: { ...next, composition };
		}, layout));
		if (removed)
			select(CANVAS_SELECTION);
	}

	/**
	 * Duplicate a layer, or every selected layer as one undo step, each as a single
	 * layer duplicates; the copies are selected.
	 */
	function duplicate(target?: FeatureMatchLayoutEditorSelection) {
		const copying = targets(target);
		const copies: FeatureMatchLayoutEditorLayer[] = [];
		const duplicated = copying.length > 0 && editLayout(layout => copying.reduce((next, layer) => {
			if (layer.type === 'source') {
				const result = layoutWriter.duplicateSource(next, layer.itemId);
				if (result.id)
					copies.push({ type: 'source', itemId: result.id });
				return result.layout;
			}
			const result = duplicateGraphicItem(next.composition, layer.itemId, { nextId: randomUuid });
			if (!result.itemId)
				return next;
			copies.push({ type: 'item', itemId: result.itemId });
			return { ...next, composition: result.graphic };
		}, layout));
		if (duplicated)
			layerSelection.value = { layers: copies, anchor: copies.at(-1) ?? null };
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

	function layerConfig(target: FeatureMatchLayoutEditorSelection) {
		return editorSelectionLayer(config.value.layout, target);
	}

	function isVisible(target: FeatureMatchLayoutEditorSelection): boolean {
		return layerConfig(target)?.visible !== false;
	}

	/**
	 * Patch what Source Items and Graphic Items both have, each through its own
	 * kind's write, as one edit.
	 */
	function patchLayers(
		patches: readonly (readonly [FeatureMatchLayoutEditorLayer, LayerPatch])[],
		editOptions: FeatureMatchLayoutEditOptions = {},
	) {
		if (patches.length === 0)
			return;
		editLayout(layout => patches.reduce((next, [layer, patch]) => {
			if (layer.type === 'source')
				return layoutWriter.patchSource(next, layer.itemId, patch);
			return {
				...next,
				composition: patchGraphicItem(next.composition, layer.itemId, patch),
			};
		}, layout), editOptions);
	}

	function patchLayer(target: FeatureMatchLayoutEditorSelection, patch: LayerPatch, editOptions: FeatureMatchLayoutEditOptions = {}) {
		if (target.type !== 'canvas') {
			patchLayers([
				[target, patch],
			], editOptions);
		}
	}

	/**
	 * Hide or show a layer. Every selected layer hides while any of them shows, and
	 * all show once all are hidden, as one undo step.
	 */
	function toggleVisible(target?: FeatureMatchLayoutEditorSelection) {
		const toggling = targets(target);
		const visible = !toggling.some(isVisible);
		patchLayers(toggling.map(layer => [
			layer,
			{ visible },
		] as const));
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

	/** Where the selected layers sit on the canvas, when the canvas can move them. */
	const selectionFrame = computed(() => editorLayersFrame(config.value.layout, layers.value, {
		width: toValue(options.canvasWidth),
		height: toValue(options.canvasHeight),
	}));

	/** Move every selected layer by the same whole-pixel delta, as one edit. */
	function translateLayers(delta: { x: number; y: number }, editOptions: FeatureMatchLayoutEditOptions) {
		if (!selectionFrame.value || (delta.x === 0 && delta.y === 0))
			return;
		patchLayers(layers.value.flatMap((layer) => {
			const rect = layerConfig(layer);
			if (!rect)
				return [];
			const moved = nudgeRect(rect, delta);
			return [
				[
					layer,
					{ x: moved.x, y: moved.y },
				] as const,
			];
		}), editOptions);
	}

	/**
	 * The canvas moved or resized the selection: one layer takes the rectangle, and
	 * several move by as far as the box they cover moved (#740).
	 */
	function setSelectionRect(rect: GraphicRect, editOptions: FeatureMatchLayoutEditOptions = {}) {
		const frame = selectionFrame.value;
		if (!frame)
			return;
		if (frame.members)
			translateLayers({ x: rect.x - frame.rect.x, y: rect.y - frame.rect.y }, editOptions);
		else
			setRect(selection.value, rect, editOptions);
	}

	/** Nudge every selected layer the canvas can move; one undo step per run of presses. */
	/** Set a Graphic Item's Graphic Rotation, as the canvas turns it. A Source Item does not turn. */
	function setRotation(target: FeatureMatchLayoutEditorSelection, rotation: number, editOptions: FeatureMatchLayoutEditOptions = {}) {
		if (target.type === 'item')
			editComposition(composition => patchGraphicItem(composition, target.itemId, { rotation }), editOptions);
	}

	function nudge(delta: { x: number; y: number }) {
		translateLayers(delta, {
			coalesce: `nudge:${layers.value.map(editorSelectionKey).join(',')}`,
		});
	}

	/**
	 * Write a shared X, Y, W or H to every selected layer's stored rectangle, as the
	 * multi-select panel edits it, one undo step per burst of typing.
	 */
	function setLayersGeometry(patch: Partial<GraphicRect>) {
		patchLayers(layers.value.map(layer => [layer, patch] as const), { coalesce: 'fields' });
	}

	return {
		writable,
		selection,
		layers,
		anchor,
		select,
		toggleSelect,
		extendSelect,
		collapseSelection,
		selectionFrame,
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
		setSelectionRect,
		setLayersGeometry,
		setRotation,
		nudge,
	};
}

export type FeatureMatchLayoutEditor = ReturnType<typeof useFeatureMatchLayoutEditor>;
