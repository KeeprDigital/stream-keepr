import type { GraphicFocalPosition, MediaGraphicItemKind } from '../../types/graphicItem';
import type {
	BroadcastGraphicConfig,
	GraphicFill,
	GraphicFillKind,
	GraphicFillStop,
	GraphicGlow,
	GraphicGroupChildConfig,
	GraphicGroupChildSizing,
	GraphicGroupItemConfig,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicOutline,
	GraphicSurfaceStyle,
	GraphicTypography,
	MediaGraphicItemConfig,
	ShapeCorner,
	ShapeCornerKey,
	ShapeGeometry,
	TextGraphicItemConfig,
} from '../../types/graphics';
import type { GraphicAssetReference } from '../../types/graphicsAsset';
import type { ShapeGeometryPresetId } from './shapeGeometry';
import { createDefaultGraphicSurfaceStyle, getGraphicItemDefinition, graphicItemKindLabel } from './itemDefinitions';
import { getShapeGeometryPreset, squareShapeGeometry } from './shapeGeometry';

/**
 * Authoring operations for a Screen's back-to-front stack of Broadcast
 * Graphics, for the Graphic Layer Order inside one Broadcast Graphic, and for
 * the Graphic Layer Order inside one Graphic Group.
 *
 * Every operation is pure: it returns the next stack or graphic and never
 * mutates its input, so the editor can hand the result straight to the Screen's
 * mode-configuration write and the same rules hold wherever they run.
 *
 * List order is Graphic Layer Order: the last entry is frontmost.
 *
 * Graphic Item ids are unique within one Broadcast Graphic, and Graphic Groups
 * do not nest, so every operation addresses an item by id alone and resolves it
 * against the top-level list and each group's children. Callers never carry a
 * path, and a Graphic Group child is edited by exactly the same helpers as a
 * top-level item.
 */

export interface CreateBroadcastGraphicOptions {
	id: string;
	name?: string;
}

export interface CreateBroadcastGraphicResult {
	graphics: BroadcastGraphicConfig[];
	graphicId: string;
}

export interface AddGraphicItemOptions {
	kind: GraphicItemKind;
	id: string;
	canvasWidth: number;
	canvasHeight: number;
}

export interface AddGraphicItemResult {
	graphic: BroadcastGraphicConfig;
	itemId: string;
}

/** The next unused `<prefix> <n>` name among existing names. */
function nextSequentialName(prefix: string, existing: readonly string[]): string {
	const taken = new Set(existing);
	let index = 1;
	while (taken.has(`${prefix} ${index}`))
		index += 1;
	return `${prefix} ${index}`;
}

function moveWithin<T>(entries: readonly T[], index: number, delta: number): T[] {
	const next = [...entries];
	const target = index + delta;
	if (index < 0 || target < 0 || target >= next.length)
		return next;
	const [moved] = next.splice(index, 1);
	next.splice(target, 0, moved!);
	return next;
}

export function createBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	options: CreateBroadcastGraphicOptions,
): CreateBroadcastGraphicResult {
	const graphic: BroadcastGraphicConfig = {
		id: options.id,
		name: options.name ?? nextSequentialName('Graphic', graphics.map(entry => entry.name)),
		items: [],
	};

	return { graphics: [...graphics, graphic], graphicId: graphic.id };
}

export function moveBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	delta: number,
): BroadcastGraphicConfig[] {
	return moveWithin(graphics, graphics.findIndex(entry => entry.id === graphicId), delta);
}

export function deleteBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
): BroadcastGraphicConfig[] {
	return graphics.filter(entry => entry.id !== graphicId);
}

export function patchBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	patch: Partial<Omit<BroadcastGraphicConfig, 'id'>>,
): BroadcastGraphicConfig[] {
	return graphics.map(entry => entry.id === graphicId ? { ...entry, ...patch } : entry);
}

export function replaceBroadcastGraphic(
	graphics: readonly BroadcastGraphicConfig[],
	graphic: BroadcastGraphicConfig,
): BroadcastGraphicConfig[] {
	return graphics.map(entry => entry.id === graphic.id ? graphic : entry);
}

/* ────────────────────────────────────────────────
 * Locating one Graphic Item
 * ──────────────────────────────────────────────── */

export interface GraphicItemLocation {
	item: GraphicItemConfig;
	/** The Graphic Group the item is a child of, when it is not top-level. */
	group?: GraphicGroupItemConfig;
}

/** One Graphic Item by id, wherever it sits in this Broadcast Graphic. */
export function findGraphicItem(graphic: BroadcastGraphicConfig, itemId: string): GraphicItemLocation | null {
	for (const item of graphic.items) {
		if (item.id === itemId)
			return { item };
		if (item.type !== 'group')
			continue;
		const child = item.children.find(candidate => candidate.id === itemId);
		if (child)
			return { item: child, group: item };
	}
	return null;
}

/** Every Graphic Item of this Broadcast Graphic, groups before their children. */
export function flattenGraphicItems(graphic: BroadcastGraphicConfig): GraphicItemConfig[] {
	return graphic.items.flatMap(item => item.type === 'group' ? [item, ...item.children] : [item]);
}

/** Every label in use, so a new item's sequential name never collides. */
function usedLabels(graphic: BroadcastGraphicConfig): string[] {
	return flattenGraphicItems(graphic).map(item => item.label);
}

/* ────────────────────────────────────────────────
 * Graphic Layer Order
 * ──────────────────────────────────────────────── */

export function addGraphicItem(
	graphic: BroadcastGraphicConfig,
	options: AddGraphicItemOptions,
): AddGraphicItemResult {
	const item = getGraphicItemDefinition(options.kind).createDefault({
		id: options.id,
		label: nextSequentialName(graphicItemKindLabel(options.kind), usedLabels(graphic)),
		canvasWidth: options.canvasWidth,
		canvasHeight: options.canvasHeight,
	});

	return {
		graphic: { ...graphic, items: [...graphic.items, item] },
		itemId: item.id,
	};
}

export interface AddGraphicGroupChildOptions {
	kind: Exclude<GraphicItemKind, 'group'>;
	id: string;
	groupId: string;
}

/**
 * Add a child to one Graphic Group. A Graphic Group is never a child of another,
 * which the option type states and this returns unchanged if asked anyway.
 *
 * A child is created against the group's own bounds rather than the Screen
 * canvas, so a new child lands inside the group it belongs to.
 */
export function addGraphicGroupChild(
	graphic: BroadcastGraphicConfig,
	options: AddGraphicGroupChildOptions,
): AddGraphicItemResult {
	const group = graphic.items.find(item => item.id === options.groupId);
	if (!group || group.type !== 'group')
		return { graphic, itemId: '' };

	const child = getGraphicItemDefinition(options.kind).createDefault({
		id: options.id,
		label: nextSequentialName(graphicItemKindLabel(options.kind), usedLabels(graphic)),
		canvasWidth: group.width,
		canvasHeight: group.height,
	}) as GraphicGroupChildConfig;

	return {
		graphic: replaceGraphicItem(graphic, { ...group, children: [...group.children, child] }),
		itemId: child.id,
	};
}

function replaceGraphicItem(graphic: BroadcastGraphicConfig, item: GraphicItemConfig): BroadcastGraphicConfig {
	return { ...graphic, items: graphic.items.map(entry => entry.id === item.id ? item : entry) };
}

/** Move one Graphic Item within its own sibling list, top-level or in a group. */
export function moveGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	delta: number,
): BroadcastGraphicConfig {
	const location = findGraphicItem(graphic, itemId);
	if (location?.group) {
		const group = location.group;
		const children = moveWithin(group.children, group.children.findIndex(child => child.id === itemId), delta);
		return replaceGraphicItem(graphic, { ...group, children });
	}

	return {
		...graphic,
		items: moveWithin(graphic.items, graphic.items.findIndex(item => item.id === itemId), delta),
	};
}

/** Delete one Graphic Item, and with a Graphic Group its children. */
export function deleteGraphicItem(graphic: BroadcastGraphicConfig, itemId: string): BroadcastGraphicConfig {
	const location = findGraphicItem(graphic, itemId);
	if (location?.group) {
		const group = location.group;
		return replaceGraphicItem(graphic, {
			...group,
			children: group.children.filter(child => child.id !== itemId),
		});
	}

	return { ...graphic, items: graphic.items.filter(item => item.id !== itemId) };
}

/* ────────────────────────────────────────────────
 * Property patches
 * ──────────────────────────────────────────────── */

/** Apply one update to the item with this id, wherever it sits. */
function updateGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	update: (item: GraphicItemConfig) => GraphicItemConfig,
): BroadcastGraphicConfig {
	return {
		...graphic,
		items: graphic.items.map((item) => {
			if (item.id === itemId)
				return update(item);
			if (item.type !== 'group' || !item.children.some(child => child.id === itemId))
				return item;
			return {
				...item,
				children: item.children.map(child =>
					child.id === itemId ? update(child) as GraphicGroupChildConfig : child,
				),
			};
		}),
	};
}

/**
 * Replace top-level properties of one Graphic Item.
 *
 * Top-level only: passing a nested object replaces it wholesale. Use the
 * property-group helpers below for geometry, surface style, fill, and typography
 * so a single-field edit cannot drop its siblings — the failure mode that appears
 * the moment a nested shape grows a second field.
 */
export function patchGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicItemConfig>,
): BroadcastGraphicConfig {
	return updateGraphicItem(graphic, itemId, item => ({ ...item, ...patch } as GraphicItemConfig));
}

/** Apply a nested merge to one item, and only when it is of an expected kind. */
function patchGraphicItemGroup<K extends GraphicItemKind>(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	kinds: readonly K[],
	merge: (item: Extract<GraphicItemConfig, { type: K }>) => Partial<GraphicItemConfig>,
): BroadcastGraphicConfig {
	const location = findGraphicItem(graphic, itemId);
	const item = location?.item;
	if (!item || !kinds.includes(item.type as K))
		return graphic;

	return patchGraphicItem(graphic, itemId, merge(item as Extract<GraphicItemConfig, { type: K }>));
}

/**
 * The kinds that own a Shape Geometry: a Shape Graphic Item and a Graphic Group
 * draw one, and a Media Graphic Item clips to one.
 */
const GEOMETRY_KINDS = ['shape', 'group', 'media'] as const;

/** The kinds that may carry a Graphic Surface Style. A Media Graphic Item paints an asset, not a surface. */
const SURFACE_KINDS = ['text', 'shape', 'group'] as const;

type GeometryOwner = Extract<GraphicItemConfig, { type: typeof GEOMETRY_KINDS[number] }>;

/**
 * Where one item keeps the Shape Geometry a geometry edit means, and what it
 * currently holds.
 *
 * A Shape Graphic Item and a Graphic Group always have a `geometry`. A Media
 * Graphic Item's `clipGeometry` is optional, and absent means it clips to nothing
 * but its own bounds — so a geometry edit aimed at one that is not clipping
 * resolves to nothing and becomes a no-op, rather than switching clipping on as a
 * side effect of nudging a corner. `setMediaClipGeometry` is the one control that
 * decides whether a media item clips at all.
 */
function ownedShapeGeometry(
	item: GeometryOwner,
): { field: 'geometry' | 'clipGeometry'; geometry: ShapeGeometry } | null {
	if (item.type === 'media')
		return item.clipGeometry ? { field: 'clipGeometry', geometry: item.clipGeometry } : null;
	return { field: 'geometry', geometry: item.geometry };
}

/** Merge into a Shape Geometry, preserving every other field. */
export function patchShapeGeometry(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<ShapeGeometry>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, GEOMETRY_KINDS, (item) => {
		const owned = ownedShapeGeometry(item);
		return owned ? { [owned.field]: { ...owned.geometry, ...patch } } : {};
	});
}

/** Merge into one independently configured corner of a Shape Geometry. */
export function patchShapeCorner(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	corner: ShapeCornerKey,
	patch: Partial<ShapeCorner>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, GEOMETRY_KINDS, (item) => {
		const owned = ownedShapeGeometry(item);
		if (!owned)
			return {};
		return {
			[owned.field]: { ...owned.geometry, [corner]: { ...owned.geometry[corner], ...patch } },
		};
	});
}

/**
 * Initialise a Shape Geometry from one authoring preset. The preset writes
 * geometry, and may propose a height; nothing records which preset was used,
 * because a preset is a shortcut rather than a persisted shape type.
 */
export function applyShapeGeometryPreset(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	presetId: ShapeGeometryPresetId,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, GEOMETRY_KINDS, (item) => {
		const owned = ownedShapeGeometry(item);
		if (!owned)
			return {};
		const result = getShapeGeometryPreset(presetId).apply({ width: item.width, height: item.height });
		return result.height === undefined
			? { [owned.field]: result.geometry }
			: { [owned.field]: result.geometry, height: result.height };
	});
}

/**
 * Turn a Media Graphic Item's optional Shape Geometry clipping on or off.
 *
 * Switching it off drops the authored clip rather than flattening it to a
 * rectangle, so the item goes back to clipping to its own bounds and nothing
 * persists a shape the author cannot see.
 */
export function setMediaClipGeometry(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	clipping: boolean,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['media'], item => ({
		clipGeometry: clipping ? (item.clipGeometry ?? squareShapeGeometry()) : undefined,
	}));
}

/** Replace top-level properties of a Media Graphic Item, with its own type checked. */
export function patchMediaGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<Omit<MediaGraphicItemConfig, 'type' | 'id'>>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['media'], () => patch);
}

/** Merge into a Media Graphic Item's focal position, preserving the other axis. */
export function patchMediaFocalPosition(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicFocalPosition>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['media'], item => ({
		focalPosition: { ...item.focalPosition, ...patch },
	}));
}

/**
 * Pin one exact Graphic Asset identity and revision on a Media Graphic Item.
 *
 * The asset's own kind decides the item's media kind, and a silent video also
 * records the revision's target compatibility, which the reference index checks.
 * Playback rate and looping survive a switch to an image and back: they are the
 * author's settings, not the asset's.
 */
export function selectMediaGraphicItemAsset(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	selection: {
		asset: GraphicAssetReference;
		mediaKind: MediaGraphicItemKind;
		videoCompatibility?: 'all-supported' | 'chromium-transparency';
	},
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['media'], () => ({
		asset: selection.asset,
		mediaKind: selection.mediaKind,
		videoCompatibility: selection.mediaKind === 'silent-video' ? selection.videoCompatibility : undefined,
	}));
}

/**
 * Unpin a Media Graphic Item's Graphic Asset, leaving an item that occupies its
 * bounds and paints nothing.
 *
 * The media kind returns to image along with the asset's own facts. Leaving it on
 * silent-video would keep offering playback-rate and looping controls on an item
 * that reads "No Graphic Asset" — controls for an asset that is no longer there.
 * The authored playback values themselves survive, because they are the author's
 * rather than the asset's.
 */
export function clearMediaGraphicItemAsset(
	graphic: BroadcastGraphicConfig,
	itemId: string,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['media'], () => ({
		asset: undefined,
		mediaKind: 'image',
		videoCompatibility: undefined,
	}));
}

/**
 * Merge into a Graphic Surface Style, preserving every other field. An item that
 * carries none yet — a Text Graphic Item, or a child inheriting its Graphic
 * Group's local default — gains one from the shared default.
 */
export function patchGraphicSurfaceStyle(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicSurfaceStyle>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, item => ({
		surfaceStyle: { ...(item.surfaceStyle ?? createDefaultGraphicSurfaceStyle()), ...patch },
	}));
}

/**
 * Drop an item's own Graphic Surface Style. A Graphic Group child then inherits
 * its group's local style default; anything else simply paints no surface.
 */
export function clearGraphicSurfaceStyle(
	graphic: BroadcastGraphicConfig,
	itemId: string,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, () => ({ surfaceStyle: undefined }));
}

/** Merge into a Graphic Group's local style default for its direct children. */
export function patchGraphicGroupDefaultChildSurfaceStyle(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicSurfaceStyle> | null,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['group'], item => ({
		defaultChildSurfaceStyle: patch === null
			? undefined
			: { ...(item.defaultChildSurfaceStyle ?? createDefaultGraphicSurfaceStyle()), ...patch },
	}));
}

function currentFillColour(fill: GraphicFill): string {
	return fill.type === 'solid' ? fill.color : (fill.stops[0]?.color ?? '#000000');
}

/**
 * A Graphic Fill switched between solid and linear gradient keeps the colour the
 * author was already working with, so changing kind is never a reset.
 */
export function setGraphicFillKind(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	kind: GraphicFillKind,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, (item) => {
		const style = item.surfaceStyle ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type === kind)
			return { surfaceStyle: style };

		const colour = currentFillColour(style.fill);
		const fill: GraphicFill = kind === 'solid'
			? { type: 'solid', color: colour }
			: {
					type: 'linear-gradient',
					angle: 90,
					stops: [
						{ color: colour, position: 0, opacity: 1 },
						{ color: '#000000', position: 1, opacity: 1 },
					],
				};

		return { surfaceStyle: { ...style, fill } };
	});
}

/** Merge into a solid Graphic Fill. */
export function patchGraphicSolidFill(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	color: string,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, (item) => {
		const style = item.surfaceStyle ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type !== 'solid')
			return { surfaceStyle: style };
		return { surfaceStyle: { ...style, fill: { type: 'solid', color } } };
	});
}

/** Merge into a linear-gradient Graphic Fill's angle. */
export function patchGraphicGradientAngle(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	angle: number,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, (item) => {
		const style = item.surfaceStyle ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type !== 'linear-gradient')
			return { surfaceStyle: style };
		return { surfaceStyle: { ...style, fill: { ...style.fill, angle } } };
	});
}

/** Merge into one colour stop of a linear-gradient Graphic Fill. */
export function patchGraphicGradientStop(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	index: number,
	patch: Partial<GraphicFillStop>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, (item) => {
		const style = item.surfaceStyle ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type !== 'linear-gradient')
			return { surfaceStyle: style };
		const stops = style.fill.stops.map((stop, position) =>
			position === index ? { ...stop, ...patch } : stop,
		);
		return { surfaceStyle: { ...style, fill: { ...style.fill, stops } } };
	});
}

/**
 * Add or remove a gradient stop. A Graphic Fill holds two to four stops, so the
 * bounds are the vocabulary's own rather than the editor's.
 */
export function changeGraphicGradientStopCount(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	delta: 1 | -1,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, (item) => {
		const style = item.surfaceStyle ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type !== 'linear-gradient')
			return { surfaceStyle: style };

		const stops = [...style.fill.stops];
		if (delta === 1 && stops.length < 4) {
			const last = stops[stops.length - 1]!;
			stops.push({ ...last, position: 1 });
		}
		else if (delta === -1 && stops.length > 2) {
			stops.pop();
		}

		return { surfaceStyle: { ...style, fill: { ...style.fill, stops } } };
	});
}

/** Merge into a Graphic Surface Style's uniform outline, or remove it. */
export function patchGraphicOutline(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicOutline> | null,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, (item) => {
		const style = item.surfaceStyle ?? createDefaultGraphicSurfaceStyle();
		return {
			surfaceStyle: {
				...style,
				outline: patch === null
					? undefined
					: { color: '#ffffff', width: 2, ...style.outline, ...patch },
			},
		};
	});
}

/** Merge into a Graphic Surface Style's glow, or remove it. */
export function patchGraphicGlow(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicGlow> | null,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_KINDS, (item) => {
		const style = item.surfaceStyle ?? createDefaultGraphicSurfaceStyle();
		return {
			surfaceStyle: {
				...style,
				glow: patch === null
					? undefined
					: { color: '#00d9ff', size: 24, opacity: 0.8, ...style.glow, ...patch },
			},
		};
	});
}

/** Replace top-level properties of a Text Graphic Item, with its own type checked. */
export function patchTextGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<Omit<TextGraphicItemConfig, 'type' | 'id'>>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['text'], () => patch);
}

/** Merge into a Text Graphic Item's base typography, preserving every other field. */
export function patchGraphicTypography(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicTypography>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['text'], item => ({
		typography: { ...item.typography, ...patch },
	}));
}

/** Replace top-level properties of a Graphic Group, with its own type checked. */
export function patchGraphicGroup(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<Omit<GraphicGroupItemConfig, 'type' | 'id' | 'children'>>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['group'], () => patch);
}

/**
 * Merge into a Graphic Group child's main-axis sizing, preserving every other
 * field. Only a child carries sizing — the wire schema rejects it on a top-level
 * Graphic Item, which has no group to be sized inside — so an edit aimed at one
 * is a no-op rather than authoring something a write would refuse.
 */
export function patchGraphicGroupChildSizing(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicGroupChildSizing>,
): BroadcastGraphicConfig {
	if (!findGraphicItem(graphic, itemId)?.group)
		return graphic;

	return patchGraphicItemGroup(graphic, itemId, ['text', 'shape', 'media'], item => ({
		sizing: { mode: 'fixed', size: item.width, weight: 1, ...item.sizing, ...patch },
	}));
}
