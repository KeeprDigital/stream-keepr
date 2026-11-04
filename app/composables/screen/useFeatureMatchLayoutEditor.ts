import type { BroadcastGraphicConfig, GraphicItemKind, GraphicRect } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayModeConfig } from '~~/shared/types/screenConfig';
import type { EditHistory } from '~/modules/feature-match-overlay/editHistory';
import type { FeatureMatchLayoutEditorLayer, FeatureMatchLayoutEditorSelection } from '~/modules/feature-match-overlay/editorSelection';
import type { LayerPosition } from '~/modules/feature-match-overlay/layerAlignment';
import type { LayerPlace } from '~/modules/feature-match-overlay/layerDrag';
import type { LayerSelection } from '~/modules/feature-match-overlay/layerSelection';
import type { AlignEdge, DistributeAxis } from '~/modules/graphics/canvasAlignment';
import type { ClipboardPasteRefusal, CopiedLayers, CopiedStyle } from '~/modules/graphics/clipboard';
import {
	addGraphicGroupChild,
	addGraphicItem,
	deleteGraphicItem,
	duplicateGraphicItem,
	findGraphicItem,
	groupGraphicItems,
	moveGraphicItem,
	moveGraphicItemToEdge,
	patchGraphicItem,
	replaceGraphicItemById,
	ungroupGraphicGroup,
} from '~~/shared/modules/graphics';
import { randomUuid } from '~~/shared/utils/uuid';
import { emptyEditHistory, recordEdit, redoEdit, undoEdit } from '~/modules/feature-match-overlay/editHistory';
import { CANVAS_SELECTION, editorLayersFrame, editorSelectionKey, editorSelectionLabel, editorSelectionLayer } from '~/modules/feature-match-overlay/editorSelection';
import { alignLayers, canAlignLayers, canDistributeLayers, distributeLayers } from '~/modules/feature-match-overlay/layerAlignment';
import { dropLayer } from '~/modules/feature-match-overlay/layerDrag';
import { layerGroupRefusal } from '~/modules/feature-match-overlay/layerGrouping';
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
import { copyGraphicLayers, copyGraphicStyle, pasteFeatureMatchLayers, pasteGraphicStyle } from '~/modules/graphics/clipboard';

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
 * picks one of several. Delete, duplicate, hide, nudge, a canvas move, align and
 * distribute act on every selected layer, each as one undo step.
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

	/**
	 * An open gesture, such as a drag on a number field's label: its first edit
	 * records the one undo step the whole gesture undoes as, however long it
	 * pauses, and it coalesces with no edit before or after it.
	 */
	let gesture: { recorded: boolean } | null = null;

	/** Record the current layout as an undo step, without writing anything. */
	function checkpoint(edit: FeatureMatchLayoutEditOptions = {}) {
		if (!writable.value || gesture?.recorded)
			return;
		history.value = recordEdit(history.value, snapshot(), {
			now: Date.now(),
			key: gesture
				? undefined
				: edit.coalesce,
		});
		if (gesture)
			gesture.recorded = true;
	}

	/** Edits from here until `endGesture` undo as one step. */
	function beginGesture() {
		gesture = { recorded: false };
	}

	function endGesture() {
		gesture = null;
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

	/**
	 * Place one layer in front of or behind another of its section, or into or out
	 * of a Graphic Group, as one undo step: a dragged row's drop, or "Move to group"
	 * (#741). The layer is then selected alone.
	 */
	function place(layer: FeatureMatchLayoutEditorLayer, where: LayerPlace) {
		if (editLayout(layout => dropLayer(layout, layer, where)))
			select(layer);
	}

	/** Why ⌘G cannot group the selected layers, or null when it can (#920). */
	const groupRefusal = computed(() => layerGroupRefusal(config.value.layout, layers.value));

	/**
	 * Wrap the selected Graphic Items in a new canvas Graphic Group, drawn where
	 * they were, as one undo step (#920, E11); the group is then selected alone.
	 */
	function group() {
		if (groupRefusal.value)
			return;
		const itemId = randomUuid();
		const itemIds = layers.value.map(layer => layer.itemId);
		if (editComposition(composition => groupGraphicItems(composition, itemIds, { id: itemId }).graphic))
			select({ type: 'item', itemId });
	}

	/**
	 * Restore a Graphic Group's children, or the selected group's, as top-level
	 * Graphic Items drawn where they were, as one undo step (#920, E12); they are
	 * then selected.
	 */
	function ungroup(target?: FeatureMatchLayoutEditorSelection) {
		const current = target ?? selection.value;
		if (current.type !== 'item')
			return;
		const result = ungroupGraphicGroup(config.value.layout.composition, current.itemId);
		if (editComposition(() => result.graphic)) {
			const children = result.itemIds.map(itemId => ({ type: 'item' as const, itemId }));
			layerSelection.value = { layers: children, anchor: children.at(-1) ?? null };
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

	const canvasSize = () => ({
		width: toValue(options.canvasWidth),
		height: toValue(options.canvasHeight),
	});

	/** Where the selected layers sit on the canvas, when the canvas can move them. */
	const selectionFrame = computed(() => editorLayersFrame(config.value.layout, layers.value, canvasSize()));

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

	/** Set a Graphic Item's Graphic Rotation, as the canvas turns it. A Source Item does not turn. */
	function setRotation(target: FeatureMatchLayoutEditorSelection, rotation: number, editOptions: FeatureMatchLayoutEditOptions = {}) {
		if (target.type === 'item')
			editComposition(composition => patchGraphicItem(composition, target.itemId, { rotation }), editOptions);
	}

	/** Nudge every selected layer the canvas can move; one undo step per run of presses. */
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

	/* ── Align and distribute (#919) ──────────────── */

	function moveLayers(moved: readonly LayerPosition[]) {
		patchLayers(moved.map(({ layer, x, y }) => [
			layer,
			{ x, y },
		] as const));
	}

	/** Whether aligning a layer, or the selection, has anything to line up. */
	function canAlign(target?: FeatureMatchLayoutEditorSelection): boolean {
		return canAlignLayers(config.value.layout, targets(target));
	}

	/** Whether the selection holds three or more layers that distribute. */
	function canDistribute(): boolean {
		return canDistributeLayers(config.value.layout, layers.value);
	}

	/**
	 * Line up an edge or centre of a layer, or of every selected layer, as one undo
	 * step: several to the bounds they cover, one to its container. Writes nothing
	 * when none would move.
	 */
	function align(edge: AlignEdge, target?: FeatureMatchLayoutEditorSelection) {
		moveLayers(alignLayers(config.value.layout, targets(target), canvasSize(), edge));
	}

	/** Space the selected layers evenly between the outermost two, as one undo step. */
	function distribute(axis: DistributeAxis) {
		moveLayers(distributeLayers(config.value.layout, layers.value, axis));
	}

	/* ── Clipboard (#746) ──────────────────────────── */

	/** Copy every selected layer. Copying is not a write, so an observer may. */
	function copy(): CopiedLayers | null {
		return copyGraphicLayers('feature-match-overlay', config.value.layout, layers.value);
	}

	/**
	 * Paste copied layers as one undo step, into the Graphic Group the selection is
	 * or sits in when nothing copied is a group, and select the copies. Answers why
	 * a paste was refused, or null.
	 */
	function paste(copied: CopiedLayers): ClipboardPasteRefusal | null {
		const outcome = pasteFeatureMatchLayers(copied, config.value.layout, {
			groupId: selectedGroup.value?.id,
			nextId: randomUuid,
		});
		if (!outcome.ok)
			return outcome.refusal;
		if (edit({ layout: outcome.layout }))
			layerSelection.value = { layers: outcome.pasted, anchor: outcome.pasted.at(-1) ?? null };
		return null;
	}

	/** Copy the style of the one selected Graphic Item. */
	function copyStyle(): CopiedStyle | null {
		const current = selection.value;
		const item = current.type === 'item'
			? findGraphicItem(config.value.layout.composition, current.itemId)?.item
			: undefined;
		return item
			? copyGraphicStyle('feature-match-overlay', item)
			: null;
	}

	/**
	 * Paste a copied style onto every selected Graphic Item it fits, as one undo
	 * step. Answers why it fits none of them, or null.
	 */
	function pasteStyle(copied: CopiedStyle): ClipboardPasteRefusal | null {
		let refusal: ClipboardPasteRefusal = { reason: 'no-destination' };
		let pasted = false;
		const composition = layers.value.reduce((next, layer) => {
			const item = layer.type === 'item'
				? findGraphicItem(next, layer.itemId)?.item
				: undefined;
			if (!item)
				return next;
			const outcome = pasteGraphicStyle(copied, 'feature-match-overlay', item);
			if (!outcome.ok) {
				refusal = outcome.refusal;
				return next;
			}
			pasted = true;
			return replaceGraphicItemById(next, outcome.item);
		}, config.value.layout.composition);
		if (!pasted)
			return refusal;
		editComposition(() => composition);
		return null;
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
		beginGesture,
		endGesture,
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
		place,
		groupRefusal,
		group,
		ungroup,
		isVisible,
		toggleVisible,
		rename,
		setRect,
		setSelectionRect,
		setLayersGeometry,
		setRotation,
		nudge,
		canAlign,
		canDistribute,
		align,
		distribute,
		copy,
		paste,
		copyStyle,
		pasteStyle,
	};
}

export type FeatureMatchLayoutEditor = ReturnType<typeof useFeatureMatchLayoutEditor>;
