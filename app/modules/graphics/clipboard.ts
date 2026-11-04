import type { BroadcastGraphicConfig, GraphicGroupChildConfig, GraphicGroupItemConfig, GraphicItemConfig } from '~~/shared/types/graphics';
import type { GraphicAssetReference, GraphicAssetReferenceStatus } from '~~/shared/types/graphicsAsset';
import type { GraphicThemeBindings, GraphicThemeSlot } from '~~/shared/types/graphicThemeBindings';
import type { FeatureMatchLayoutConfig, FeatureMatchSourceItemConfig } from '~~/shared/types/screenConfig';
import { MAX_FEATURE_MATCH_SOURCE_ITEMS } from '~~/shared/featureMatchSourceItems';
import {
	cloneGraphicItem,
	copyLabeller,
	findGraphicItem,
	flattenGraphicItems,
	getGraphicItemDefinition,
	GRAPHIC_ITEM_DUPLICATE_OFFSET,
	graphicTextTemplateProjectedValueReferences,
	readSocialProfileProjectedValueReference,
	replaceBroadcastGraphic,
} from '~~/shared/modules/graphics';
import {
	MAX_GRAPHIC_GROUP_CHILDREN,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC,
	MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN,
	MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT,
} from '~~/shared/types/graphics';
import { broadcastGraphicsGraphicAssetReferences } from '~~/shared/utils/graphicsAssetReferences';

/**
 * The graphics clipboard (#746): copy and paste of layers, and of one layer's
 * style, in the Feature Match Overlay and Broadcast Graphics editors.
 *
 * - **App-local (E23).** What is copied is kept in this browser's storage, not the
 *   system clipboard, so it pastes across Screens and Events in the same browser.
 * - **Same host (E24).** Layers and styles paste only into the host they were
 *   copied from; the other host refuses them with a reason.
 * - **Whole or nothing (E25).** A paste that would pass a Graphic Item cap
 *   (ADR-0007), or pin a Graphic Asset no longer selectable, is refused whole and
 *   names what stopped it. The server still checks every reference at commit
 *   (ADR-0034); this is what lets the author know before.
 * - **Style (E26).** Every style group pastes between items of one Graphic Item
 *   Definition; between two kinds that both paint a surface, only the Graphic
 *   Surface Style does.
 *
 * Copies keep their Graphic Theme Bindings, so a bound layer takes the look of the
 * Screen it lands on. A pasted style group carries its binding state: bound in the
 * source binds the target, unbound pastes the literal and detaches the target.
 */

export type GraphicsClipboardHost = 'feature-match-overlay' | 'broadcast-graphics';

/** One layer to copy: a Graphic Item, or a Feature Match Layout's Source Item. */
export interface ClipboardLayer {
	type: 'item' | 'source';
	itemId: string;
}

/** One copied Graphic Item, and where its container's origin sat on the canvas. */
export interface CopiedGraphicItem {
	item: GraphicItemConfig;
	/** The canvas for a top-level item; a Graphic Group's padded box for its child. */
	origin: { x: number; y: number };
}

export interface CopiedLayers {
	kind: 'layers';
	host: GraphicsClipboardHost;
	/** Back to front, as they were layered. */
	items: CopiedGraphicItem[];
	/** A Feature Match Layout's Source Items, back to front. */
	sources: FeatureMatchSourceItemConfig[];
}

export interface CopiedStyle {
	kind: 'style';
	host: GraphicsClipboardHost;
	/** The item the style was copied from: its kind decides what pastes where. */
	item: GraphicItemConfig;
}

export type GraphicsClipboardEntry = CopiedLayers | CopiedStyle;

/** Why a paste was refused. Nothing is pasted when one is. */
export type ClipboardPasteRefusal
	= | { reason: 'other-host'; from: GraphicsClipboardHost }
		| { reason: 'item-cap'; scope: 'screen' | 'graphic' | 'layout' | 'group'; limit: number }
		| { reason: 'source-cap'; limit: number }
		/** Items pinning a Graphic Asset that is retired, trashed, missing or unavailable, by label. */
		| { reason: 'unselectable'; items: string[] }
		/** Items reading a Social Profile Projection outside its Presentation Group, by label. */
		| { reason: 'projection'; items: string[] }
		/** A style pasted onto a kind that shares none of it. */
		| { reason: 'incompatible' }
		/** Nothing selected that could take the paste. */
		| { reason: 'no-destination' };

/* ────────────────────────────────────────────────
 * Copy
 * ──────────────────────────────────────────────── */

/** Where a Graphic Item's container places its origin on the canvas. */
function containerOrigin(group: GraphicGroupItemConfig | undefined): { x: number; y: number } {
	if (!group)
		return { x: 0, y: 0 };
	const padding = Math.max(0, group.padding);
	return { x: group.x + padding, y: group.y + padding };
}

/** A detached copy of stored configuration, which may arrive as a reactive proxy. */
function detached<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Copy layers of one composition, back to front as they are layered, whatever
 * order they were selected in. Nothing when none of them is there.
 */
export function copyGraphicLayers(
	host: GraphicsClipboardHost,
	source: { composition: BroadcastGraphicConfig; sources?: readonly FeatureMatchSourceItemConfig[] },
	layers: readonly ClipboardLayer[],
): CopiedLayers | null {
	const itemIds = new Set(layers.filter(layer => layer.type === 'item').map(layer => layer.itemId));
	const sourceIds = new Set(layers.filter(layer => layer.type === 'source').map(layer => layer.itemId));
	const items = flattenGraphicItems(source.composition)
		.filter(item => itemIds.has(item.id))
		.map((item) => {
			const location = findGraphicItem(source.composition, item.id)!;
			return {
				item: detached(item),
				origin: containerOrigin(location.group),
			};
		});
	const sources = (source.sources ?? [])
		.filter(item => sourceIds.has(item.id))
		.map(detached);
	return items.length + sources.length > 0
		? { kind: 'layers', host, items, sources }
		: null;
}

export function copyGraphicStyle(host: GraphicsClipboardHost, item: GraphicItemConfig): CopiedStyle {
	return {
		kind: 'style',
		host,
		item: detached(item),
	};
}

/* ────────────────────────────────────────────────
 * Paste layers
 * ──────────────────────────────────────────────── */

function graphicItemCount(items: readonly GraphicItemConfig[]): number {
	return items.reduce((total, item) => total + 1 + (item.type === 'group'
		? item.children.length
		: 0), 0);
}

export interface PasteOptions {
	/** The Graphic Group the selection is or sits in: where copied children land. */
	groupId?: string | null;
	/** Mints each copy's id. */
	nextId: () => string;
}

interface CompositionPaste {
	composition: BroadcastGraphicConfig;
	/** The Graphic Group the copies land in, or none for the top level. */
	group: GraphicGroupItemConfig | undefined;
	itemIds: string[];
}

/**
 * Paste copied Graphic Items in front of everything in their container, offset
 * from where they were on the canvas. They land in `groupId`'s Graphic Group when
 * there is one and nothing copied is a group, since Graphic Groups do not nest;
 * otherwise on the canvas.
 */
function pasteIntoComposition(
	composition: BroadcastGraphicConfig,
	copied: readonly CopiedGraphicItem[],
	options: PasteOptions,
): CompositionPaste {
	const candidate = options.groupId
		? composition.items.find(item => item.id === options.groupId)
		: undefined;
	const group = candidate?.type === 'group' && copied.every(entry => entry.item.type !== 'group')
		? candidate
		: undefined;
	const destination = containerOrigin(group);
	const label = copyLabeller(flattenGraphicItems(composition).map(item => item.label), { keep: true });
	const copies = copied.map(({ item, origin }) => {
		const copy = cloneGraphicItem(item, { nextId: options.nextId, label });
		copy.x += origin.x - destination.x + GRAPHIC_ITEM_DUPLICATE_OFFSET;
		copy.y += origin.y - destination.y + GRAPHIC_ITEM_DUPLICATE_OFFSET;
		// Only a row or column group reads a child's sizing, and only a child may carry one.
		if (!group)
			delete copy.sizing;
		return copy;
	});
	const itemIds = copies.map(copy => copy.id);
	if (group) {
		const next = {
			...group,
			children: [
				...group.children,
				...copies as GraphicGroupChildConfig[],
			],
		};
		return {
			composition: {
				...composition,
				items: composition.items.map(item => item.id === group.id
					? next
					: item),
			},
			group: next,
			itemIds,
		};
	}
	return {
		composition: {
			...composition,
			items: [
				...composition.items,
				...copies,
			],
		},
		group,
		itemIds,
	};
}

/** The Social Profile Projections one item reads, by key. */
function projectionKeysRead(item: GraphicItemConfig): string[] {
	if (item.type === 'social-network-icon') {
		return typeof item.network === 'object'
			? [item.network.projectionKey]
			: [];
	}
	if (item.type !== 'text')
		return [];
	return [
		...graphicTextTemplateProjectedValueReferences(item.text).map(reference => reference.projectionKey),
		...Object.keys(item.placeholderStyles ?? {})
			.flatMap(key => readSocialProfileProjectedValueReference(key)?.projectionKey ?? []),
	];
}

/**
 * The pasted items reading a Social Profile Projection outside its Presentation
 * Group in `graphic`, which the write path refuses: a projection does not travel
 * with the items reading it.
 */
function strandedProjectionReaders(graphic: BroadcastGraphicConfig, itemIds: readonly string[]): string[] {
	const groups = new Map((graphic.socialProfileProjections ?? []).map(projection => [projection.key, projection.presentationGroupId]));
	return itemIds.flatMap((itemId) => {
		const location = findGraphicItem(graphic, itemId)!;
		const readers = location.item.type === 'group'
			? location.item.children.map(child => ({ item: child as GraphicItemConfig, groupId: location.item.id as string | undefined }))
			: [
					{ item: location.item, groupId: location.group?.id },
				];
		return readers
			.filter(({ item, groupId }) => projectionKeysRead(item).some(key => groups.get(key) === undefined || groups.get(key) !== groupId))
			.map(({ item }) => item.label);
	});
}

export type BroadcastGraphicLayersPaste
	= | { ok: true; graphics: BroadcastGraphicConfig[]; pasted: string[] }
		| { ok: false; refusal: ClipboardPasteRefusal };

/** Paste copied layers into one Broadcast Graphic of a Screen's stack. */
export function pasteBroadcastGraphicLayers(
	copied: CopiedLayers,
	destination: { graphics: readonly BroadcastGraphicConfig[]; graphicId: string },
	options: PasteOptions,
): BroadcastGraphicLayersPaste {
	if (copied.host !== 'broadcast-graphics') {
		return {
			ok: false,
			refusal: { reason: 'other-host', from: copied.host },
		};
	}
	const graphic = destination.graphics.find(entry => entry.id === destination.graphicId);
	if (!graphic) {
		return {
			ok: false,
			refusal: { reason: 'no-destination' },
		};
	}

	const paste = pasteIntoComposition(graphic, copied.items, options);
	const added = graphicItemCount(copied.items.map(entry => entry.item));
	const onScreen = destination.graphics.reduce((total, entry) => total + graphicItemCount(entry.items), 0);
	if (onScreen + added > MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN) {
		return {
			ok: false,
			refusal: { reason: 'item-cap', scope: 'screen', limit: MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHICS_SCREEN },
		};
	}
	if (paste.composition.items.length > MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC) {
		return {
			ok: false,
			refusal: { reason: 'item-cap', scope: 'graphic', limit: MAX_GRAPHIC_ITEMS_PER_BROADCAST_GRAPHIC },
		};
	}
	if (paste.group && paste.group.children.length > MAX_GRAPHIC_GROUP_CHILDREN) {
		return {
			ok: false,
			refusal: { reason: 'item-cap', scope: 'group', limit: MAX_GRAPHIC_GROUP_CHILDREN },
		};
	}
	const stranded = strandedProjectionReaders(paste.composition, paste.itemIds);
	if (stranded.length > 0) {
		return {
			ok: false,
			refusal: { reason: 'projection', items: stranded },
		};
	}

	return {
		ok: true,
		graphics: replaceBroadcastGraphic(destination.graphics, paste.composition),
		pasted: paste.itemIds,
	};
}

export type FeatureMatchLayersPaste
	= | { ok: true; layout: FeatureMatchLayoutConfig; pasted: ClipboardLayer[] }
		| { ok: false; refusal: ClipboardPasteRefusal };

/** Paste copied layers into a Feature Match Layout: Source Items in front of its Source Items. */
export function pasteFeatureMatchLayers(
	copied: CopiedLayers,
	layout: FeatureMatchLayoutConfig,
	options: PasteOptions,
): FeatureMatchLayersPaste {
	if (copied.host !== 'feature-match-overlay') {
		return {
			ok: false,
			refusal: { reason: 'other-host', from: copied.host },
		};
	}

	const paste = pasteIntoComposition(layout.composition, copied.items, options);
	if (graphicItemCount(paste.composition.items) > MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT) {
		return {
			ok: false,
			refusal: { reason: 'item-cap', scope: 'layout', limit: MAX_GRAPHIC_ITEMS_PER_FEATURE_MATCH_LAYOUT },
		};
	}
	if (paste.group && paste.group.children.length > MAX_GRAPHIC_GROUP_CHILDREN) {
		return {
			ok: false,
			refusal: { reason: 'item-cap', scope: 'group', limit: MAX_GRAPHIC_GROUP_CHILDREN },
		};
	}
	if (layout.sources.length + copied.sources.length > MAX_FEATURE_MATCH_SOURCE_ITEMS) {
		return {
			ok: false,
			refusal: { reason: 'source-cap', limit: MAX_FEATURE_MATCH_SOURCE_ITEMS },
		};
	}

	const label = copyLabeller(layout.sources.map(source => source.label), { keep: true });
	// A copy lands unlocked, as a pasted Graphic Item does (`cloneGraphicItem`).
	const sources = copied.sources.map(({ locked: _locked, ...source }) => ({
		...detached(source),
		id: options.nextId(),
		label: label(source.label),
		x: source.x + GRAPHIC_ITEM_DUPLICATE_OFFSET,
		y: source.y + GRAPHIC_ITEM_DUPLICATE_OFFSET,
	}));
	return {
		ok: true,
		layout: {
			...layout,
			composition: paste.composition,
			sources: [
				...layout.sources,
				...sources,
			],
		},
		pasted: [
			...paste.itemIds.map(itemId => ({ type: 'item' as const, itemId })),
			...sources.map(source => ({ type: 'source' as const, itemId: source.id })),
		],
	};
}

/** Whether a reference can still be chosen: an active Graphic Asset whose content is available. */
function isSelectable(status: GraphicAssetReferenceStatus): boolean {
	return status.outcome === 'available' && status.lifecycleState === 'active';
}

/** Every Graphic Asset Revision one item pins itself, a Graphic Group's children aside. */
function pinnedReferences(item: GraphicItemConfig): GraphicAssetReference[] {
	const own = item.type === 'group'
		? { ...item, children: [] }
		: item;
	return broadcastGraphicsGraphicAssetReferences({
		graphics: [
			{
				id: 'clipboard',
				name: 'clipboard',
				items: [own],
			},
		],
	})
		.map(entry => entry.reference);
}

/** What a style paste pins: a library font in its typography, the only style group that names an asset. */
function stylePinnedReferences(item: GraphicItemConfig): GraphicAssetReference[] {
	const font = 'typography' in item
		? item.typography.font
		: undefined;
	return font?.kind === 'asset'
		? [font.reference]
		: [];
}

/**
 * The copied items, by label, that pin a Graphic Asset no longer selectable (E25),
 * asked of the Graphics Asset Library through `status` once per distinct revision.
 * An asset-bound Media Graphic Item's last-resolved revision counts like any other;
 * a copied style counts only what it pastes.
 */
export async function unselectableCopiedItems(
	copied: GraphicsClipboardEntry,
	status: (reference: GraphicAssetReference) => Promise<GraphicAssetReferenceStatus>,
): Promise<string[]> {
	const pinned = copied.kind === 'style'
		? [
				{
					label: copied.item.label,
					references: stylePinnedReferences(copied.item),
				},
			]
		: copied.items
				.flatMap(({ item }) => item.type === 'group'
					? [item, ...item.children]
					: [item])
				.map(item => ({
					label: item.label,
					references: pinnedReferences(item),
				}));
	const statuses = new Map<string, Promise<boolean>>();
	function selectable(reference: GraphicAssetReference) {
		const key = `${reference.assetId}\0${reference.revisionId}`;
		if (!statuses.has(key))
			statuses.set(key, status(reference).then(isSelectable));
		return statuses.get(key)!;
	}
	const verdicts = await Promise.all(pinned.map(async entry => ({
		label: entry.label,
		selectable: (await Promise.all(entry.references.map(selectable))).every(Boolean),
	})));
	return verdicts.filter(entry => !entry.selectable).map(entry => entry.label);
}

/* ────────────────────────────────────────────────
 * Paste a style
 * ──────────────────────────────────────────────── */

/** One style group of an item: the field it is stored in and the Theme binding slots over it. */
interface StyleGroup {
	field: string;
	slots: GraphicThemeSlot[];
}

const SURFACE: StyleGroup = {
	field: 'surfaceStyle',
	slots: ['surfaceStyle', 'surfaceStyle.fill'],
};

/** Every style group a Graphic Item Definition declares: typography, Graphic Surface Styles and Shape Geometry. */
function styleGroups(item: GraphicItemConfig): StyleGroup[] {
	const definition = getGraphicItemDefinition(item.type);
	return [
		...(definition.typography
			? [
					{
						field: 'typography',
						slots: ['typography', 'typography.color'] as GraphicThemeSlot[],
					},
				]
			: []),
		...Object.keys(definition.surfaceStyles ?? {}).map(slot => slot === 'surfaceStyle'
			? SURFACE
			: {
					field: slot,
					slots: [slot as GraphicThemeSlot],
				}),
		...(definition.shapeGeometry
			? [
					{
						field: definition.shapeGeometry.slot,
						slots: [definition.shapeGeometry.slot],
					},
				]
			: []),
	];
}

function paintsSurface(item: GraphicItemConfig): boolean {
	return styleGroups(item).includes(SURFACE);
}

export type StylePaste
	= | { ok: true; item: GraphicItemConfig; scope: 'style' | 'surface' }
		| { ok: false; refusal: ClipboardPasteRefusal };

/**
 * Paste a copied style onto one item (E26). Each pasted group takes the source's
 * value, or its absence, and its binding state.
 */
export function pasteGraphicStyle(copied: CopiedStyle, host: GraphicsClipboardHost, target: GraphicItemConfig): StylePaste {
	if (copied.host !== host) {
		return {
			ok: false,
			refusal: { reason: 'other-host', from: copied.host },
		};
	}
	const source = copied.item;
	const scope = source.type === target.type
		? 'style'
		: paintsSurface(source) && paintsSurface(target)
			? 'surface'
			: null;
	if (!scope) {
		return {
			ok: false,
			refusal: { reason: 'incompatible' },
		};
	}

	const from = source as unknown as Record<string, unknown>;
	const item = { ...target } as unknown as Record<string, unknown>;
	const bindings: GraphicThemeBindings = { ...target.themeBindings };
	for (const group of scope === 'style'
		? styleGroups(source)
		: [SURFACE]) {
		if (from[group.field] === undefined)
			delete item[group.field];
		else
			item[group.field] = detached(from[group.field]);
		for (const slot of group.slots) {
			const token = source.themeBindings?.[slot];
			if (token === undefined)
				delete bindings[slot];
			else
				bindings[slot] = token;
		}
	}
	if (Object.keys(bindings).length > 0)
		item.themeBindings = bindings;
	else
		delete item.themeBindings;
	return { ok: true, item: item as unknown as GraphicItemConfig, scope };
}

/* ────────────────────────────────────────────────
 * Storage
 * ──────────────────────────────────────────────── */

/**
 * One key per kind, so copying a style keeps the layers copied before it. The
 * version is in the key: an entry an older build wrote is never read as current.
 */
const STORAGE_KEYS = {
	layers: 'stream-keepr:graphics-clipboard:layers:v1',
	style: 'stream-keepr:graphics-clipboard:style:v1',
} as const satisfies Record<GraphicsClipboardEntry['kind'], string>;

type ClipboardStorage = Pick<Storage, 'getItem' | 'setItem'>;

function browserStorage(): ClipboardStorage | undefined {
	try {
		return globalThis.localStorage;
	}
	catch {
		return undefined;
	}
}

/** Keep what was copied in this browser. Answers whether it was kept. */
export function writeGraphicsClipboard(entry: GraphicsClipboardEntry, storage = browserStorage()): boolean {
	try {
		storage?.setItem(STORAGE_KEYS[entry.kind], JSON.stringify(entry));
		return storage !== undefined;
	}
	catch {
		return false;
	}
}

function isHost(value: unknown): value is GraphicsClipboardHost {
	return value === 'feature-match-overlay' || value === 'broadcast-graphics';
}

/** What was last copied of one kind in this browser, or nothing. */
export function readGraphicsClipboard<K extends GraphicsClipboardEntry['kind']>(
	kind: K,
	storage = browserStorage(),
): Extract<GraphicsClipboardEntry, { kind: K }> | null {
	try {
		const raw = storage?.getItem(STORAGE_KEYS[kind]);
		const entry = raw
			? JSON.parse(raw) as Record<string, unknown>
			: null;
		if (!entry || entry.kind !== kind || !isHost(entry.host))
			return null;
		const shaped = kind === 'layers'
			? Array.isArray(entry.items) && Array.isArray(entry.sources)
			: typeof entry.item === 'object' && entry.item !== null;
		return shaped
			? entry as unknown as Extract<GraphicsClipboardEntry, { kind: K }>
			: null;
	}
	catch {
		return null;
	}
}

/* ────────────────────────────────────────────────
 * Wording
 * ──────────────────────────────────────────────── */

const HOST_NAMES: Record<GraphicsClipboardHost, string> = {
	'feature-match-overlay': 'a Feature Match Layout',
	'broadcast-graphics': 'a Broadcast Graphic',
};

const CAP_SCOPES: Record<Extract<ClipboardPasteRefusal, { reason: 'item-cap' }>['scope'], string> = {
	screen: 'this Screen',
	graphic: 'one Broadcast Graphic',
	layout: 'one Feature Match Layout',
	group: 'one Graphic Group',
};

function quoted(labels: readonly string[]): string {
	return labels.map(label => `"${label}"`).join(', ');
}

/** The reason an author reads for a refused paste. */
export function clipboardRefusalMessage(refusal: ClipboardPasteRefusal): string {
	switch (refusal.reason) {
		case 'other-host':
			return `This was copied from ${HOST_NAMES[refusal.from]}, and pastes only into ${HOST_NAMES[refusal.from]}.`;
		case 'item-cap':
			return `Nothing was pasted: it would pass the limit of ${refusal.limit} Graphic Items in ${CAP_SCOPES[refusal.scope]}.`;
		case 'source-cap':
			return `Nothing was pasted: it would pass the limit of ${refusal.limit} Source Items in one Feature Match Layout.`;
		case 'unselectable':
			return `Nothing was pasted: ${quoted(refusal.items)} use a Graphic Asset that is retired, missing or unavailable.`;
		case 'projection':
			return `Nothing was pasted: ${quoted(refusal.items)} read a Social Profile Projection, so they paste only into its Presentation Group.`;
		case 'incompatible':
			return 'This style pastes only onto the same kind of layer, or its surface onto another layer that paints one.';
		case 'no-destination':
			return 'Select where to paste first.';
	}
}
