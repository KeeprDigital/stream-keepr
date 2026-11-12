import type { MaybeRefOrGetter } from 'vue';
import type { GraphicItemLocation } from '~~/shared/modules/graphics';
import type { GraphicsHostContract } from '~~/shared/modules/graphics/hostContract';
import type { BroadcastGraphicConfig, GraphicRect } from '~~/shared/types/graphics';
import type { SnapLayer } from '~/modules/graphics/canvasManipulation';
import type { ClipboardPasteRefusal, CopiedLayers } from '~/modules/graphics/clipboard';
import { toValue } from 'vue';
import { findGraphicItem, patchGraphicItem, replaceGraphicItemById, withoutLayerLock } from '~~/shared/modules/graphics';

/**
 * The editor half of the Host Contract: what a graphics Screen Mode declares to
 * the shared graphics editor, so one editor serves every host.
 *
 * The shared half (`shared/modules/graphics/hostContract.ts`) says what the
 * compositor reads. This half says what the editor reads, in three parts:
 *
 * - **Item tree contents** (`tree`): which layers the document holds, in what
 *   order, and how each kind is written. Graphic Items are the same in every host,
 *   so the editor writes them itself through the shared authoring operations; a
 *   host names only the composition each sits in. A layer the host owns, such as a
 *   Feature Match Layout's Source Item, is written by the host (`owned`).
 * - **Document written** (`document`): where the edited document is read from and
 *   written to. One undo step is one whole document.
 * - **Forbidden edits** (`forbidden`): when this session may not write at all (no
 *   Graphics Authoring Lease, or the host is holding the editor), and which
 *   compositions it may not write now.
 *
 * `D` is the host's document, `L` its layer reference. The tree is pure, so the
 * editor's rules are tested on it without a mounted editor.
 */

/**
 * One Graphic Item tree the editor writes: a Broadcast Graphic, or the
 * composition a Feature Match Layout holds, which has the same shape.
 */
export type GraphicComposition = BroadcastGraphicConfig;

/** A layer reference. `type` names its kind and is never `'canvas'`. */
export interface GraphicsEditorLayer {
	readonly type: string;
}

/** Nothing selected, or several: the canvas itself. */
export interface GraphicsEditorCanvasSelection {
	readonly type: 'canvas';
}

/** One selection: the canvas, or one layer. */
export type GraphicsEditorSelection<L extends GraphicsEditorLayer> = GraphicsEditorCanvasSelection | L;

export const CANVAS_SELECTION: GraphicsEditorCanvasSelection = { type: 'canvas' };

export function isCanvasSelection(selection: GraphicsEditorLayer): selection is GraphicsEditorCanvasSelection {
	return selection.type === 'canvas';
}

/** What every layer stores, Graphic Item and host-owned alike. */
export interface GraphicsEditorLayerConfig extends GraphicRect {
	id: string;
	label: string;
	visible?: boolean;
	locked?: boolean;
}

/** A write to what every layer stores. `locked: false` stores the layer as one never locked. */
export type GraphicsEditorLayerPatch = Partial<GraphicRect> & { label?: string; visible?: boolean; locked?: boolean };

/** The writes of a layer kind the host owns, each answering the same document when it changes nothing. */
export interface GraphicsEditorOwnedLayers<D, L extends GraphicsEditorLayer> {
	/** What the layer list's add menu calls one, such as "Source Item". */
	label: string;
	/** The icon its layer list row and add menu show. */
	icon: string;
	/** Add a new one in front of its siblings. */
	create: (document: D) => { document: D; layer: L };
	find: (document: D, layer: L) => GraphicsEditorLayerConfig | undefined;
	/** The layers this one is ordered among, back to front, itself included. */
	siblings: (document: D, layer: L) => L[];
	patch: (document: D, layer: L, patch: GraphicsEditorLayerPatch) => D;
	remove: (document: D, layer: L) => D;
	/** Copy a layer in front of itself, unlocked. A null layer when it is unknown. */
	duplicate: (document: D, layer: L) => { document: D; layer: L | null };
	/** Put a layer at an index among its siblings, clamped to them. */
	reorder: (document: D, layer: L, index: number) => D;
}

export type GraphicsEditorPaste<D, L extends GraphicsEditorLayer>
	= | { ok: true; document: D; pasted: L[] }
		| { ok: false; refusal: ClipboardPasteRefusal };

/** Item tree contents: the layers a host's document holds, and how each is written. */
export interface GraphicsEditorTree<D, L extends GraphicsEditorLayer> {
	/** The shared half of the Host Contract; its `hostId` is the clipboard's host. */
	host: GraphicsHostContract;
	/** A stable name for a layer: a DOM key, and an undo coalescing key. */
	key: (layer: L) => string;
	/** Every layer in the layer list's order, front to back, a group's children beneath it. */
	order: (document: D) => L[];
	/** Every composition the document holds: what `forbidden.composition` is asked of. */
	compositions: (document: D) => readonly GraphicComposition[];
	/** The composition a Graphic Item layer sits in and its id there; null for a layer the host owns. */
	item: (document: D, layer: L) => { composition: GraphicComposition; itemId: string } | null;
	/** The layer naming a Graphic Item of a composition. */
	itemLayer: (composition: GraphicComposition, itemId: string) => L;
	/** The composition a new or pasted Graphic Item joins, given what is selected. */
	destination: (document: D, selected: readonly L[]) => GraphicComposition | null;
	/** The document with one composition replaced, matched by its id, or added when it has none by that id. */
	withComposition: (document: D, composition: GraphicComposition) => D;
	/** Everything positioned on the canvas a layer sits on: what it snaps to. */
	canvasLayers: (document: D, layer: L) => readonly SnapLayer[];
	/**
	 * Why a layer cannot be removed on its own, or null when it can: a Broadcast
	 * Graphic's Presentation Group goes only with its Social Profile Projection.
	 */
	removal?: (document: D, layer: L) => string | null;
	/** The layer kind the host owns, when it has one. */
	owned?: GraphicsEditorOwnedLayers<D, L>;
	/** Copy layers. Copying is not a write. */
	copy: (document: D, layers: readonly L[]) => CopiedLayers | null;
	/** Paste copied layers under the host's own caps, whole or not at all. */
	paste: (
		copied: CopiedLayers,
		document: D,
		into: { selected: readonly L[]; groupId?: string; nextId: () => string },
	) => GraphicsEditorPaste<D, L>;
}

/** One section of the layer list, as a host names it: a Feature Match Layout's Source Items, or one Broadcast Graphic. */
export interface GraphicsLayerListSection<L extends GraphicsEditorLayer> {
	key: string;
	title: string;
	/** Its layers front to back, each group's children beneath it. */
	layers: readonly L[];
	empty: string;
}

/** Document written: where the editor reads the document and where an edit goes. */
export interface GraphicsEditorDocument<D> {
	read: () => D;
	write: (next: D) => void;
	/**
	 * What an undo or redo writes, given the document it restores and the one it
	 * replaces: a host keeps here what it sets outside undo. The restored document
	 * when absent.
	 */
	restore?: (restored: D, current: D) => D;
}

/** Forbidden edits: when and what this session may not write. */
export interface GraphicsEditorForbiddenEdits {
	/**
	 * Whether this session holds the Screen's Graphics Authoring Lease (ADR-0030).
	 * Required, so an editor that forgot the lease cannot write.
	 */
	writable: () => boolean;
	/**
	 * Whether the host is rewriting the document itself, as a template placement
	 * does: the editor writes nothing until it is over, and keeps its undo history.
	 */
	held?: () => boolean;
	/**
	 * Whether a composition may not be written now, such as a Broadcast Graphic on
	 * air: no write changes it, none of its Graphic Items is written, nothing is
	 * added to it, and undo and redo leave it as it is.
	 */
	composition?: (composition: GraphicComposition) => boolean;
}

export interface GraphicsEditorHostContract<D, L extends GraphicsEditorLayer> {
	tree: GraphicsEditorTree<D, L>;
	document: GraphicsEditorDocument<D>;
	forbidden: GraphicsEditorForbiddenEdits;
	/** The canvas the document is authored in, in pixels. */
	canvas: () => { width: number; height: number };
}

/**
 * A composition's Graphic Item layers in the layer list's order: front to
 * back, each Graphic Group's children beneath it.
 */
export function compositionItemLayers<L>(composition: GraphicComposition, layer: (itemId: string) => L): L[] {
	return [...composition.items].reverse().flatMap(item => [
		layer(item.id),
		...(item.type === 'group'
			? [...item.children].reverse().map(child => layer(child.id))
			: []),
	]);
}

/** What every host's session says alike: whether it may write, whether it is held, and its canvas. */
export interface GraphicsEditorSessionOptions {
	/** Whether this session holds the Screen's Graphics Authoring Lease (ADR-0030). */
	writable: MaybeRefOrGetter<boolean>;
	/** Whether a template placement is in flight, the server rewriting the document. */
	held?: MaybeRefOrGetter<boolean>;
	canvasWidth: MaybeRefOrGetter<number>;
	canvasHeight: MaybeRefOrGetter<number>;
}

/** A host's lease and placement edits forbidden, and its canvas, from its session. */
export function graphicsEditorSession(options: GraphicsEditorSessionOptions): Pick<GraphicsEditorHostContract<unknown, GraphicsEditorLayer>, 'canvas'> & { forbidden: Required<Pick<GraphicsEditorForbiddenEdits, 'writable' | 'held'>> } {
	return {
		forbidden: {
			writable: () => toValue(options.writable),
			held: () => toValue(options.held) ?? false,
		},
		canvas: () => ({
			width: toValue(options.canvasWidth),
			height: toValue(options.canvasHeight),
		}),
	};
}

/* ── Reading and writing a layer of either kind ── */

/** Where a Graphic Item layer sits in its composition; nothing for a host-owned layer or one that has gone. */
export function layerItemLocation<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layer: L,
): (GraphicItemLocation & { composition: GraphicComposition }) | undefined {
	const item = tree.item(document, layer);
	const location = item && findGraphicItem(item.composition, item.itemId);
	return item && location
		? { ...location, composition: item.composition }
		: undefined;
}

/** The stored layer a reference names, of either kind; nothing once it has left the document. */
export function layerConfig<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layer: L,
): GraphicsEditorLayerConfig | undefined {
	return tree.item(document, layer)
		? layerItemLocation(tree, document, layer)?.item
		: tree.owned?.find(document, layer);
}

/** The layer of the Graphic Group a Graphic Item is a child of. */
export function layerParentGroup<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layer: L,
): L | undefined {
	const location = layerItemLocation(tree, document, layer);
	return location?.group
		? tree.itemLayer(location.composition, location.group.id)
		: undefined;
}

/** Whether two layers are the same layer. */
export function isSameLayer<D, L extends GraphicsEditorLayer>(tree: GraphicsEditorTree<D, L>, a: L, b: L): boolean {
	return tree.key(a) === tree.key(b);
}

/** Write what every layer stores to one layer, through its own kind's write. */
export function patchLayer<D, L extends GraphicsEditorLayer>(
	tree: GraphicsEditorTree<D, L>,
	document: D,
	layer: L,
	patch: GraphicsEditorLayerPatch,
): D {
	const item = tree.item(document, layer);
	if (!item)
		return tree.owned?.patch(document, layer, patch) ?? document;
	const { locked, ...fields } = patch;
	let composition = Object.keys(fields).length > 0
		? patchGraphicItem(item.composition, item.itemId, fields)
		: item.composition;
	const stored = locked === undefined
		? undefined
		: findGraphicItem(composition, item.itemId)?.item;
	if (stored) {
		composition = replaceGraphicItemById(composition, locked
			? { ...stored, locked: true }
			: withoutLayerLock(stored));
	}
	return composition === item.composition
		? document
		: tree.withComposition(document, composition);
}
