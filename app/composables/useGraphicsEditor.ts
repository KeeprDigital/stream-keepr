import type { GraphicItemKind, GraphicRect } from '~~/shared/types/graphics';
import type { AlignEdge, DistributeAxis } from '~/modules/graphics/canvasAlignment';
import type { ClipboardPasteRefusal, CopiedLayers, CopiedStyle } from '~/modules/graphics/clipboard';
import type { EditHistory } from '~/modules/graphics/editor/editHistory';
import type {
	GraphicComposition,
	GraphicsEditorHostContract,
	GraphicsEditorLayer,
	GraphicsEditorLayerPatch,
	GraphicsEditorSelection,
} from '~/modules/graphics/editor/host';
import type { LayerPosition } from '~/modules/graphics/editor/layerAlignment';
import type { LayerPlace } from '~/modules/graphics/editor/layerDrag';
import type { LayerSelection } from '~/modules/graphics/editor/layerSelection';
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
import { nudgeRect } from '~/modules/graphics/canvasManipulation';
import { copyGraphicStyle, pasteGraphicStyle } from '~/modules/graphics/clipboard';
import { emptyEditHistory, recordEdit, redoEdit, undoEdit } from '~/modules/graphics/editor/editHistory';
import {
	CANVAS_SELECTION,
	isCanvasSelection,
	isSameLayer,
	layerConfig,
	layerItemLocation,
	patchLayer as patchStoredLayer,
} from '~/modules/graphics/editor/host';
import { alignLayers, canAlignLayers, canDistributeLayers, distributeLayers } from '~/modules/graphics/editor/layerAlignment';
import { dropLayer } from '~/modules/graphics/editor/layerDrag';
import { editorLayerCanvasBox, editorLayersFrame } from '~/modules/graphics/editor/layerFrame';
import { layerGroupRefusal } from '~/modules/graphics/editor/layerGrouping';
import { isLayerLocked, isLockedByGroup, toggleLayerLocks } from '~/modules/graphics/editor/layerLocks';
import {
	collapseLayerSelection,
	extendLayerSelection,
	NO_LAYERS,
	onlyLayer,
	pruneLayerSelection,
	toggleLayer,
} from '~/modules/graphics/editor/layerSelection';

export interface GraphicsEditOptions {
	/**
	 * Edits sharing a key within a moment of each other undo as one step: the
	 * frames of one drag, the keystrokes of one field. Structural edits pass none.
	 */
	coalesce?: string;
}

/**
 * The shared graphics editor's verbs, over its selection and its undo history,
 * for whichever host supplies the Host Contract's editor half
 * (`~/modules/graphics/editor/host`).
 *
 * Every write the editor makes goes through `commit`, which records the document
 * it replaces, so the layer list, the property panel, the canvas, and the
 * keyboard all undo alike. One undo step is one whole document.
 *
 * The selection is none, one or several layers (#740). `selection` names its one
 * layer, or the canvas with none or several, so a verb aimed at one layer never
 * picks one of several. Delete, duplicate, hide, nudge, a canvas move, align and
 * distribute act on every selected layer, each as one undo step.
 *
 * The selection follows each structural edit — an added or duplicated layer is
 * selected, a removed one gives way to the canvas — and lets go of a layer
 * whenever it leaves the document, whoever removed it.
 *
 * Only a session holding the Graphics Authoring Lease writes (#738): without it
 * every verb writes and records nothing, and losing it ends the undo history,
 * since the next holder's changes would be undone over.
 *
 * While the host holds the editor, as a template placement in flight does, every
 * verb, undo and redo included, writes nothing, since each writes a whole document
 * from before the host's own write. The history is kept, and a `checkpoint` still
 * records, so the host's write undoes as one step.
 *
 * A composition the host forbids, such as a Broadcast Graphic on air, is left
 * alone: no write that changes or removes it, or reorders it among the others
 * forbidden, is made, by a verb or a host's own `edit`. Undo and redo restore
 * everything but it, and keep a step that would restore nothing else. Its layers
 * are still selected and copied.
 *
 * A locked layer (#747) is left alone by every canvas verb — a move, a resize, a
 * rotation and an arrow nudge — and still edited by the property panel. The
 * lock is stored on the layer (#943), so locking is an edit like any other: one
 * undo step, and only while leased.
 */
/** Whether two documents, or two of their parts, hold the same content. */
function sameContent(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function useGraphicsEditor<D, L extends GraphicsEditorLayer>(contract: GraphicsEditorHostContract<D, L>) {
	const { tree, forbidden } = contract;
	const read = () => contract.document.read();
	const leased = computed(() => forbidden.writable());
	/** Whether this session may edit now: it holds the lease, and the host is not holding the editor. */
	const writable = computed(() => leased.value && !forbidden.held?.());

	const layerSelection = shallowRef<LayerSelection<L>>(NO_LAYERS);
	/** Every selected layer, in the order the author chose them. */
	const layers = computed(() => layerSelection.value.layers);
	/** The layer the author chose last: the one the layer list keeps in view. */
	const anchor = computed(() => layerSelection.value.anchor);
	/** The one selected layer, or the canvas with none or several. */
	const selection = computed<GraphicsEditorSelection<L>>(() => layers.value.length === 1
		? layers.value[0]!
		: CANVAS_SELECTION);
	const history = shallowRef<EditHistory<D>>(emptyEditHistory());

	const canUndo = computed(() => writable.value && history.value.past.length > 0);
	const canRedo = computed(() => writable.value && history.value.future.length > 0);

	watch(leased, (isLeased) => {
		if (!isLeased)
			history.value = emptyEditHistory();
	});

	function snapshot(): D {
		return JSON.parse(JSON.stringify(read()));
	}

	function selectLayers(next: readonly L[]) {
		layerSelection.value = { layers: next, anchor: next.at(-1) ?? null };
	}

	/** Select one layer, or none with the canvas. */
	function select(next: GraphicsEditorSelection<L>) {
		layerSelection.value = isCanvasSelection(next)
			? NO_LAYERS
			: onlyLayer(next);
	}

	/** ⌘-click: add a layer to the selection, or take it out. */
	function toggleSelect(layer: L) {
		layerSelection.value = toggleLayer(tree, read(), layerSelection.value, layer);
	}

	/** Shift-click: select the layer list's run from the anchor to this layer. */
	function extendSelect(layer: L) {
		layerSelection.value = extendLayerSelection(tree, read(), layerSelection.value, layer);
	}

	/** Escape: several layers to the one chosen last, one to none. */
	function collapseSelection() {
		layerSelection.value = collapseLayerSelection(layerSelection.value);
	}

	watch(read, (document) => {
		layerSelection.value = pruneLayerSelection(tree, document, layerSelection.value);
	});

	/**
	 * An open gesture, such as a drag on a number field's label: its first edit
	 * records the one undo step the whole gesture undoes as, however long it
	 * pauses, and it coalesces with no edit before or after it.
	 */
	let gesture: { recorded: boolean } | null = null;

	/** Record the current document as an undo step, without writing anything. */
	function checkpoint(edit: GraphicsEditOptions = {}) {
		if (!leased.value || gesture?.recorded)
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
	 * Make one undoable write: the one funnel every verb takes. A host passes its
	 * own `write` for a field edit that reaches the document by its own path.
	 * Answers whether it wrote, which it does only while leased and not held.
	 */
	function commit(write: () => void, editOptions: GraphicsEditOptions = {}): boolean {
		if (!writable.value)
			return false;
		checkpoint(editOptions);
		write();
		return true;
	}

	/** Write the document as one undoable edit. Answers the same document, or one changing a forbidden composition, as no edit at all. */
	function edit(next: D, editOptions: GraphicsEditOptions = {}): boolean {
		return next !== read()
			&& !changesForbidden(next)
			&& commit(() => contract.document.write(next), editOptions);
	}

	/** Field edits from the property panels: one undo step per burst of typing. */
	function editFields(next: D) {
		edit(next, { coalesce: 'fields' });
	}

	/**
	 * What an undo or redo writes: the document it restores, with each composition
	 * the host forbids now left as it is, and what the host keeps outside undo.
	 * `withheld` says the step changes a forbidden composition, or their order.
	 */
	function restoring(restored: D): { document: D; withheld: boolean } {
		const current = read();
		const forbiddenNow = tree.compositions(current).filter(composition => !mayEditComposition(composition));
		const before = new Map(tree.compositions(restored).map(composition => [composition.id, composition]));
		const withheld = forbiddenNow.some(composition => !sameContent(before.get(composition.id), composition))
			|| !sameContent(orderAmong(restored, forbiddenNow), forbiddenNow.map(composition => composition.id));
		const kept = forbiddenNow.reduce((next, composition) => tree.withComposition(next, composition), restored);
		return {
			document: contract.document.restore?.(kept, current) ?? kept,
			withheld,
		};
	}

	/**
	 * Take one undo or redo step. A step that would only change what the host
	 * forbids now writes nothing and is kept, so it still undoes once the
	 * composition may be written again; the host is told (`stepWithheld`).
	 */
	function step(name: 'undo' | 'redo') {
		const current = snapshot();
		const taken = (name === 'undo'
			? undoEdit
			: redoEdit)(history.value, current);
		if (!taken)
			return;
		const { document, withheld } = restoring(taken.restore);
		if (withheld && sameContent(document, current)) {
			forbidden.stepWithheld?.(name);
			return;
		}
		history.value = taken.history;
		contract.document.write(document);
	}

	function undo() {
		if (canUndo.value)
			step('undo');
	}

	/**
	 * Forget every undo and redo step. Called when someone else changes the
	 * document: a step recorded before their change would put back a whole document
	 * without it. Answers whether there was anything to forget.
	 */
	function discardHistory(): boolean {
		const had = canUndo.value || canRedo.value;
		history.value = emptyEditHistory();
		return had;
	}

	function redo() {
		if (canRedo.value)
			step('redo');
	}

	/* ── Forbidden edits ───────────────────────────── */

	function mayEditComposition(composition: GraphicComposition): boolean {
		return !forbidden.composition?.(composition);
	}

	/** The ids of `among` in the order `document` holds them. */
	function orderAmong(document: D, among: readonly GraphicComposition[]): string[] {
		const ids = new Set(among.map(composition => composition.id));
		return tree.compositions(document).map(composition => composition.id).filter(id => ids.has(id));
	}

	/**
	 * Whether a document would change or remove a composition the host forbids
	 * now, or reorder those compositions among themselves: Broadcast Graphics on
	 * air composite in stack order.
	 */
	function changesForbidden(next: D): boolean {
		if (!forbidden.composition)
			return false;
		const forbiddenNow = tree.compositions(read()).filter(composition => !mayEditComposition(composition));
		const after = new Map(tree.compositions(next).map(composition => [composition.id, composition]));
		return forbiddenNow.some(composition => after.get(composition.id) !== composition)
			|| orderAmong(next, forbiddenNow).some((id, index) => id !== forbiddenNow[index]!.id);
	}

	/** Whether the host lets this layer be written now. A layer it owns always is. */
	function mayEdit(layer: L): boolean {
		const item = tree.item(read(), layer);
		return !item || mayEditComposition(item.composition);
	}

	/* ── Graphic Items ─────────────────────────────── */

	/** Edit the composition a Graphic Item layer sits in, unless the host forbids it. */
	function editItem(
		layer: L,
		apply: (composition: GraphicComposition, itemId: string) => GraphicComposition,
		editOptions: GraphicsEditOptions = {},
	): boolean {
		const item = tree.item(read(), layer);
		if (!item || !mayEditComposition(item.composition))
			return false;
		const composition = apply(item.composition, item.itemId);
		return composition !== item.composition
			&& edit(tree.withComposition(read(), composition), editOptions);
	}

	/** The composition a new Graphic Item joins, when the host lets it be edited. */
	function destination(): GraphicComposition | null {
		const composition = tree.destination(read(), layers.value);
		return composition && mayEditComposition(composition)
			? composition
			: null;
	}

	/** Whether a new Graphic Item has somewhere to go now. */
	function canAddItem(): boolean {
		return writable.value && destination() !== null;
	}

	function addItem(kind: GraphicItemKind) {
		const composition = destination();
		if (!composition)
			return;
		const itemId = randomUuid();
		const canvas = contract.canvas();
		const added = addGraphicItem(composition, {
			kind,
			id: itemId,
			canvasWidth: canvas.width,
			canvasHeight: canvas.height,
		}).graphic;
		if (added !== composition && edit(tree.withComposition(read(), added)))
			select(tree.itemLayer(added, itemId));
	}

	/** The Graphic Group the selection is, or sits in. */
	const selectedGroup = computed(() => {
		const current = selection.value;
		const location = isCanvasSelection(current)
			? undefined
			: layerItemLocation(tree, read(), current);
		if (location?.group)
			return location.group;
		return location?.item.type === 'group'
			? location.item
			: null;
	});

	function addGroupChild(kind: Exclude<GraphicItemKind, 'group'>) {
		const group = selectedGroup.value;
		const current = selection.value;
		if (!group || isCanvasSelection(current))
			return;
		const itemId = randomUuid();
		let added: GraphicComposition | undefined;
		if (editItem(current, (composition) => {
			added = addGraphicGroupChild(composition, { kind, groupId: group.id, id: itemId }).graphic;
			return added;
		}) && added) {
			select(tree.itemLayer(added, itemId));
		}
	}

	/* ── Host-owned layers ─────────────────────────── */

	/** Add one of the layers the host owns, such as a Source Item, and select it. */
	function addHostLayer() {
		const created = tree.owned?.create(read());
		if (created && edit(created.document))
			select(created.layer);
	}

	/* ── Either kind of layer ──────────────────────── */

	/** Why a layer cannot be removed on its own, or null when it can. */
	function removalRefusal(layer: L): string | null {
		return tree.removal?.(read(), layer) ?? null;
	}

	/** The layers a verb acts on: the one it names, or every selected layer; never one the host forbids. */
	function targets(target?: GraphicsEditorSelection<L>): L[] {
		const named = target
			? isCanvasSelection(target)
				? []
				: [target]
			: [...layers.value];
		return named.filter(mayEdit);
	}

	/** One named layer, when it is a layer the host lets be written. */
	function oneTarget(target: GraphicsEditorSelection<L>): L | null {
		return targets(target)[0] ?? null;
	}

	/** Apply a write to each layer in turn, as one edit. */
	function editEach(over: readonly L[], apply: (document: D, layer: L) => D, editOptions: GraphicsEditOptions = {}): boolean {
		return over.length > 0 && edit(over.reduce(apply, read()), editOptions);
	}

	/** Remove a layer, or every selected layer as one undo step, leaving any the host keeps from going alone. */
	function remove(target?: GraphicsEditorSelection<L>) {
		const removed = editEach(targets(target).filter(layer => removalRefusal(layer) === null), (next, layer) => {
			const item = tree.item(next, layer);
			if (!item)
				return tree.owned?.remove(next, layer) ?? next;
			const composition = deleteGraphicItem(item.composition, item.itemId);
			return composition === item.composition
				? next
				: tree.withComposition(next, composition);
		});
		if (removed)
			select(CANVAS_SELECTION);
	}

	/**
	 * Duplicate a layer, or every selected layer as one undo step, each as a single
	 * layer duplicates; the copies are selected.
	 */
	function duplicate(target?: GraphicsEditorSelection<L>) {
		const copies: L[] = [];
		const duplicated = editEach(targets(target), (next, layer) => {
			const item = tree.item(next, layer);
			if (!item) {
				const result = tree.owned?.duplicate(next, layer);
				if (result?.layer)
					copies.push(result.layer);
				return result?.document ?? next;
			}
			const result = duplicateGraphicItem(item.composition, item.itemId, { nextId: randomUuid });
			if (!result.itemId)
				return next;
			copies.push(tree.itemLayer(result.graphic, result.itemId));
			return tree.withComposition(next, result.graphic);
		});
		if (duplicated)
			selectLayers(copies);
	}

	/** Put a host-owned layer at an index among its siblings, counted from where it is. */
	function reorderOwned(layer: L, index: (current: number, count: number) => number) {
		const owned = tree.owned;
		if (!owned)
			return;
		const siblings = owned.siblings(read(), layer);
		const current = siblings.findIndex(sibling => isSameLayer(tree, sibling, layer));
		if (current >= 0)
			edit(owned.reorder(read(), layer, index(current, siblings.length)));
	}

	/** Move one layer a step toward the front (+1) or the back (-1) of its own list. */
	function move(target: GraphicsEditorSelection<L>, delta: 1 | -1) {
		const layer = oneTarget(target);
		if (!layer)
			return;
		if (tree.item(read(), layer))
			editItem(layer, (composition, itemId) => moveGraphicItem(composition, itemId, delta));
		else
			reorderOwned(layer, current => current + delta);
	}

	function moveToEdge(target: GraphicsEditorSelection<L>, edge: 'front' | 'back') {
		const layer = oneTarget(target);
		if (!layer)
			return;
		if (tree.item(read(), layer)) {
			editItem(layer, (composition, itemId) => moveGraphicItemToEdge(composition, itemId, edge));
		}
		else {
			reorderOwned(layer, (_, count) => edge === 'front'
				? count - 1
				: 0);
		}
	}

	/**
	 * Place one layer in front of or behind another of its section, or into or out
	 * of a Graphic Group, as one undo step: a dragged row's drop, or "Move to group"
	 * (#741). The layer is then selected alone.
	 */
	function place(layer: L, where: LayerPlace<L>) {
		if (mayEdit(layer) && edit(dropLayer(tree, read(), layer, where)))
			select(layer);
	}

	/** Why ⌘G cannot group the selected layers, or null when it can (#920). */
	const groupRefusal = computed(() => layerGroupRefusal(tree, read(), layers.value));

	/**
	 * Wrap the selected Graphic Items in a new canvas Graphic Group, drawn where
	 * they were, as one undo step (#920, E11); the group is then selected alone.
	 */
	function group() {
		const first = layers.value[0];
		if (groupRefusal.value || !first)
			return;
		const itemId = randomUuid();
		const itemIds = layers.value.map(layer => tree.item(read(), layer)!.itemId);
		let grouped: GraphicComposition | undefined;
		if (editItem(first, (composition) => {
			grouped = groupGraphicItems(composition, itemIds, { id: itemId }).graphic;
			return grouped;
		}) && grouped) {
			select(tree.itemLayer(grouped, itemId));
		}
	}

	/**
	 * Restore a Graphic Group's children, or the selected group's, as top-level
	 * Graphic Items drawn where they were, as one undo step (#920, E12); they are
	 * then selected.
	 */
	function ungroup(target?: GraphicsEditorSelection<L>) {
		const layer = oneTarget(target ?? selection.value);
		if (!layer)
			return;
		let children: L[] = [];
		if (editItem(layer, (composition, itemId) => {
			const result = ungroupGraphicGroup(composition, itemId);
			children = result.itemIds.map(id => tree.itemLayer(result.graphic, id));
			return result.graphic;
		})) {
			selectLayers(children);
		}
	}

	function stored(target: GraphicsEditorSelection<L>) {
		return isCanvasSelection(target)
			? undefined
			: layerConfig(tree, read(), target);
	}

	function isVisible(target: GraphicsEditorSelection<L>): boolean {
		return stored(target)?.visible !== false;
	}

	/** Patch what every layer has, each through its own kind's write, as one edit. */
	function patchLayers(
		patches: readonly (readonly [L, GraphicsEditorLayerPatch])[],
		editOptions: GraphicsEditOptions = {},
	) {
		const allowed = patches.filter(([layer]) => mayEdit(layer));
		if (allowed.length === 0)
			return;
		edit(allowed.reduce((next, [layer, patch]) => patchStoredLayer(tree, next, layer, patch), read()), editOptions);
	}

	function patchLayer(target: GraphicsEditorSelection<L>, patch: GraphicsEditorLayerPatch, editOptions: GraphicsEditOptions = {}) {
		if (!isCanvasSelection(target)) {
			patchLayers([
				[target, patch],
			], editOptions);
		}
	}

	/**
	 * Hide or show a layer. Every selected layer hides while any of them shows, and
	 * all show once all are hidden, as one undo step.
	 */
	function toggleVisible(target?: GraphicsEditorSelection<L>) {
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
	function rename(target: GraphicsEditorSelection<L>, name: string) {
		const label = name.trim();
		const current = stored(target)?.label;
		if (label !== '' && current !== undefined && label !== current)
			patchLayer(target, { label });
	}

	/* ── Layer Locks ───────────────────────────────── */

	/** Whether the canvas leaves a layer alone: locked in its own right, or through its group. */
	function isLocked(target: GraphicsEditorSelection<L>): boolean {
		return !isCanvasSelection(target) && isLayerLocked(tree, read(), target);
	}

	/** Whether a Graphic Item is locked only because its Graphic Group is, so its own lock cannot free it. */
	function isLockedByItsGroup(target: L): boolean {
		return isLockedByGroup(tree, read(), target);
	}

	/**
	 * Lock or unlock a layer, or every selected layer, as one undo step: all lock
	 * while any is unlocked, and all unlock once all are locked.
	 */
	function toggleLock(target?: GraphicsEditorSelection<L>) {
		const toggling = targets(target);
		if (toggling.length > 0)
			edit(toggleLayerLocks(tree, read(), toggling));
	}

	/** Where each selected locked layer sits on the canvas, for its lock badge. */
	const lockedSelectionBoxes = computed(() => layers.value.flatMap((layer) => {
		const box = isLocked(layer)
			? editorLayerCanvasBox(tree, read(), layer)
			: null;
		return box
			? [box]
			: [];
	}));

	/* ── The canvas ────────────────────────────────── */

	/** Set a layer's stored rectangle, as the canvas moves or resizes it. A locked layer stays put. */
	function setRect(target: GraphicsEditorSelection<L>, rect: GraphicRect, editOptions: GraphicsEditOptions = {}) {
		if (!isLocked(target))
			patchLayer(target, rect, editOptions);
	}

	/** Where the selected layers sit on the canvas, when the canvas can move them; a locked one cannot be. */
	const selectionFrame = computed(() => editorLayersFrame(tree, read(), layers.value, contract.canvas(), isLocked));

	/** Move every selected unlocked layer by the same whole-pixel delta, as one edit. */
	function translateLayers(delta: { x: number; y: number }, editOptions: GraphicsEditOptions) {
		if (!selectionFrame.value || (delta.x === 0 && delta.y === 0))
			return;
		patchLayers(layers.value.filter(layer => !isLocked(layer)).flatMap((layer) => {
			const rect = stored(layer);
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
	function setSelectionRect(rect: GraphicRect, editOptions: GraphicsEditOptions = {}) {
		const frame = selectionFrame.value;
		if (!frame)
			return;
		if (frame.members)
			translateLayers({ x: rect.x - frame.rect.x, y: rect.y - frame.rect.y }, editOptions);
		else
			setRect(selection.value, rect, editOptions);
	}

	/** Set a Graphic Item's Graphic Rotation, as the canvas turns it. A host-owned layer does not turn, nor a locked item. */
	function setRotation(target: GraphicsEditorSelection<L>, rotation: number, editOptions: GraphicsEditOptions = {}) {
		if (!isCanvasSelection(target) && !isLocked(target))
			editItem(target, (composition, itemId) => patchGraphicItem(composition, itemId, { rotation }), editOptions);
	}

	/** Nudge every selected layer the canvas can move, skipping a locked one; one undo step per run of presses. */
	function nudge(delta: { x: number; y: number }) {
		translateLayers(delta, {
			coalesce: `nudge:${layers.value.map(layer => tree.key(layer)).join(',')}`,
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

	function moveLayers(moved: readonly LayerPosition<L>[]) {
		patchLayers(moved.map(({ layer, x, y }) => [
			layer,
			{ x, y },
		] as const));
	}

	/** Whether aligning a layer, or the selection, has anything to line up. */
	function canAlign(target?: GraphicsEditorSelection<L>): boolean {
		return canAlignLayers(tree, read(), targets(target));
	}

	/** Whether the selection holds three or more layers that distribute. */
	function canDistribute(): boolean {
		return canDistributeLayers(tree, read(), layers.value);
	}

	/**
	 * Line up an edge or centre of a layer, or of every selected layer, as one undo
	 * step: several to the bounds they cover, one to its container. Writes nothing
	 * when none would move.
	 */
	function align(edge: AlignEdge, target?: GraphicsEditorSelection<L>) {
		moveLayers(alignLayers(tree, read(), targets(target), contract.canvas(), edge));
	}

	/** Space the selected layers evenly between the outermost two, as one undo step. */
	function distribute(axis: DistributeAxis) {
		moveLayers(distributeLayers(tree, read(), layers.value, axis));
	}

	/* ── Clipboard (#746) ──────────────────────────── */

	/** Copy every selected layer. Copying is not a write, so an observer may. */
	function copy(): CopiedLayers | null {
		return tree.copy(read(), layers.value);
	}

	/**
	 * Paste copied layers as one undo step, into the Graphic Group the selection is
	 * or sits in when nothing copied is a group, and select the copies. Answers why
	 * a paste was refused, or null.
	 */
	function paste(copied: CopiedLayers): ClipboardPasteRefusal | null {
		const into = tree.destination(read(), layers.value);
		if (into && !mayEditComposition(into))
			return { reason: 'no-destination' };
		const outcome = tree.paste(copied, read(), {
			selected: layers.value,
			groupId: selectedGroup.value?.id,
			nextId: randomUuid,
		});
		if (!outcome.ok)
			return outcome.refusal;
		if (edit(outcome.document))
			selectLayers(outcome.pasted);
		return null;
	}

	/** The Graphic Item a layer names, in the document as it is being rewritten. */
	function itemIn(document: D, layer: L) {
		const item = tree.item(document, layer);
		const found = item && findGraphicItem(item.composition, item.itemId)?.item;
		return item && found
			? { composition: item.composition, item: found }
			: undefined;
	}

	/** Copy the style of the one selected Graphic Item. */
	function copyStyle(): CopiedStyle | null {
		const current = selection.value;
		const found = isCanvasSelection(current)
			? undefined
			: itemIn(read(), current);
		return found
			? copyGraphicStyle(tree.host.hostId, found.item)
			: null;
	}

	/**
	 * Paste a copied style onto every selected Graphic Item it fits, as one undo
	 * step. Answers why it fits none of them, or null.
	 */
	function pasteStyle(copied: CopiedStyle): ClipboardPasteRefusal | null {
		let refusal: ClipboardPasteRefusal = { reason: 'no-destination' };
		let pasted = false;
		const next = layers.value.filter(mayEdit).reduce((document, layer) => {
			const found = itemIn(document, layer);
			if (!found)
				return document;
			const outcome = pasteGraphicStyle(copied, tree.host.hostId, found.item);
			if (!outcome.ok) {
				refusal = outcome.refusal;
				return document;
			}
			pasted = true;
			return tree.withComposition(document, replaceGraphicItemById(found.composition, outcome.item));
		}, read());
		if (!pasted)
			return refusal;
		edit(next);
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
		commit,
		edit,
		editFields,
		undo,
		redo,
		addItem,
		canAddItem,
		addGroupChild,
		addHostLayer,
		remove,
		removalRefusal,
		mayEdit,
		mayEditComposition,
		changesForbidden,
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
		isLocked,
		isLockedByItsGroup,
		toggleLock,
		lockedSelectionBoxes,
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

export type GraphicsEditor<D, L extends GraphicsEditorLayer> = ReturnType<typeof useGraphicsEditor<D, L>>;
