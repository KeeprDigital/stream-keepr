import type { GraphicFocalPosition } from '../../types/graphicItem';
import type {
	BroadcastGraphicConfig,
	GameWinsGraphicItemConfig,
	GraphicAnimationPhase,
	GraphicAnimationRecipe,
	GraphicAnimationStagger,
	GraphicContainerAnimation,
	GraphicFadeChannel,
	GraphicFill,
	GraphicFillKind,
	GraphicFillStop,
	GraphicGlow,
	GraphicGroupChildConfig,
	GraphicGroupChildSizing,
	GraphicGroupItemConfig,
	GraphicInputChoiceOption,
	GraphicInputDeclaration,
	GraphicInputType,
	GraphicItemConfig,
	GraphicItemKind,
	GraphicOnScreenAnimationRecipe,
	GraphicOutline,
	GraphicPlaceholderStyle,
	GraphicRevealChannel,
	GraphicScaleChannel,
	GraphicSlideChannel,
	GraphicSurfaceStyle,
	GraphicTypography,
	MediaGraphicItemConfig,
	PlayerLifeGraphicItemConfig,
	ShapeCorner,
	ShapeCornerKey,
	ShapeGeometry,
	TextGraphicItemConfig,
	TextOverflowPolicy,
} from '../../types/graphics';
import type { GraphicAssetReference } from '../../types/graphicsAsset';
import type { ShapeGeometryPresetId } from './shapeGeometry';
import { GRAPHIC_ANIMATION_PHASE_VALUES, GRAPHIC_INPUT_KEY_PATTERN, MAX_GRAPHIC_INPUT_KEY_LENGTH } from '../../types/graphics';
import { createDefaultGraphicAnimationRecipe, getGraphicAnimationPreset } from './animation';
import { createDefaultGraphicInputDeclaration } from './inputs';
import { createDefaultGraphicSurfaceStyle, getGraphicItemDefinition, GRAPHIC_GROUP_CHILD_KINDS, graphicItemKindLabel } from './itemDefinitions';
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
 * Graphic Inputs
 * ──────────────────────────────────────────────── */

/**
 * A stable Graphic Input key derived from a label, made unique among the ones this
 * Broadcast Graphic already declares.
 *
 * The key is generated once and never changes afterwards, which is what makes it
 * stable: a `{inputKey}` placeholder, a Graphic Input Binding, a Graphic
 * Placeholder Style, and every accepted value in a running Live Session all name
 * it. Renaming is what the freely editable label is for.
 */
export function graphicInputKeyFromLabel(label: string, taken: readonly string[]): string {
	const slug = label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, MAX_GRAPHIC_INPUT_KEY_LENGTH);
	const base = GRAPHIC_INPUT_KEY_PATTERN.test(slug) ? slug : 'input';
	const used = new Set(taken);
	if (!used.has(base))
		return base;

	let suffix = 2;
	while (used.has(`${base}-${suffix}`))
		suffix += 1;
	return `${base}-${suffix}`;
}

export function addGraphicInput(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	type: GraphicInputType,
): BroadcastGraphicConfig[] {
	return graphics.map((graphic) => {
		if (graphic.id !== graphicId)
			return graphic;

		const inputs = graphic.inputs ?? [];
		const label = nextSequentialName('Input', inputs.map(input => input.label));
		const declaration = createDefaultGraphicInputDeclaration(type, {
			key: graphicInputKeyFromLabel(label, inputs.map(input => input.key)),
			label,
		});

		return { ...graphic, inputs: [...inputs, declaration] };
	});
}

/**
 * Merge into one Graphic Input declaration.
 *
 * The key is not patchable: a declaration's own type decides which other
 * properties it has, and both are what a placeholder, a binding, and every
 * accepted value already name.
 */
export function patchGraphicInput(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	key: string,
	patch: Partial<Omit<GraphicInputDeclaration, 'key' | 'type'>>,
): BroadcastGraphicConfig[] {
	return graphics.map(graphic => graphic.id === graphicId
		? {
				...graphic,
				inputs: (graphic.inputs ?? []).map(input =>
					input.key === key ? { ...input, ...patch } as GraphicInputDeclaration : input,
				),
			}
		: graphic);
}

/**
 * Stop declaring one Graphic Input, and drop what referenced it.
 *
 * Its Graphic Input Binding and every Graphic Placeholder Style naming it go with
 * it, because both address it by key and neither means anything once nothing
 * declares that key. A `{inputKey}` placeholder left in a Graphic Text Template is
 * deliberately not rewritten: it is the author's own text, and it simply renders
 * nothing until they declare that key again or edit it away.
 */
export function deleteGraphicInput(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	key: string,
): BroadcastGraphicConfig[] {
	return graphics.map((graphic) => {
		if (graphic.id !== graphicId)
			return graphic;

		return {
			...graphic,
			inputs: (graphic.inputs ?? []).filter(input => input.key !== key),
			bindings: graphic.bindings?.filter(binding => binding.inputKey !== key),
			items: graphic.items.map(item => stripPlaceholderStyle(item, key)),
		};
	});
}

function stripPlaceholderStyle<T extends GraphicItemConfig>(item: T, key: string): T {
	if (item.type === 'group')
		return { ...item, children: item.children.map(child => stripPlaceholderStyle(child, key)) };
	if (item.type !== 'text' || !item.placeholderStyles || !(key in item.placeholderStyles))
		return item;

	const { [key]: _removed, ...kept } = item.placeholderStyles;
	return { ...item, placeholderStyles: Object.keys(kept).length > 0 ? kept : undefined };
}

/** Replace a choice Graphic Input's option list. */
export function setGraphicInputChoiceOptions(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	key: string,
	options: GraphicInputChoiceOption[],
): BroadcastGraphicConfig[] {
	return graphics.map(graphic => graphic.id === graphicId
		? {
				...graphic,
				inputs: (graphic.inputs ?? []).map(input =>
					input.key === key && input.type === 'choice' ? { ...input, options } : input,
				),
			}
		: graphic);
}

/**
 * Merge into one `{inputKey}` placeholder's Graphic Placeholder Style, or remove
 * it so the placeholder renders in the item's base typography again.
 */
export function patchGraphicPlaceholderStyle(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	inputKey: string,
	patch: Partial<GraphicPlaceholderStyle> | null,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['text'], (item) => {
		if (patch === null)
			return stripPlaceholderStyle(item, inputKey);

		return {
			placeholderStyles: {
				...item.placeholderStyles,
				[inputKey]: { ...item.placeholderStyles?.[inputKey], ...patch },
			},
		};
	});
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

/**
 * Delete one Graphic Item, and with a Graphic Group its children.
 *
 * The deleted id also leaves its container's staggered subsets. A stagger that
 * still named a deleted item would project correctly — an unknown id is ignored —
 * but it would linger in the stored configuration and reappear the moment an
 * author created a new item that happened to reuse the id.
 */
export function deleteGraphicItem(graphic: BroadcastGraphicConfig, itemId: string): BroadcastGraphicConfig {
	const location = findGraphicItem(graphic, itemId);
	if (location?.group) {
		const group = location.group;
		return replaceGraphicItem(graphic, {
			...group,
			children: group.children.filter(child => child.id !== itemId),
			animation: withoutStaggeredItem(group.animation, itemId),
		});
	}

	return {
		...graphic,
		items: graphic.items.filter(item => item.id !== itemId),
		animation: withoutStaggeredItem(graphic.animation, itemId),
	};
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
 * draw one, a Media Graphic Item clips to one, and a Game Wins Graphic Item
 * shapes its win boxes with one.
 */
const GEOMETRY_KINDS = ['shape', 'group', 'media', 'game-wins'] as const;

/**
 * Where one Graphic Item keeps a Graphic Surface Style.
 *
 * Most kinds have exactly one, optional, and named `surfaceStyle`. A Game Wins
 * Graphic Item has three: its own, and the two that paint a win box before and
 * after the Player wins it — an unwon box and a won one are the whole point of
 * the indicator, so both are ordinary authored surfaces rather than one style
 * with a hardcoded variant.
 */
export const GRAPHIC_SURFACE_STYLE_SLOTS = ['surfaceStyle', 'boxSurfaceStyle', 'wonBoxSurfaceStyle'] as const;
export type GraphicSurfaceStyleSlot = typeof GRAPHIC_SURFACE_STYLE_SLOTS[number];

/**
 * The kinds each slot exists on. A Media Graphic Item paints an asset rather
 * than a surface and so carries none; the two box slots belong to Game Wins
 * alone.
 */
const SURFACE_SLOT_KINDS: Record<GraphicSurfaceStyleSlot, readonly GraphicItemKind[]> = {
	surfaceStyle: ['text', 'shape', 'group', 'clock', 'player-life', 'game-wins'],
	boxSurfaceStyle: ['game-wins'],
	wonBoxSurfaceStyle: ['game-wins'],
};

/** The kinds whose own Graphic Surface Style is optional, so it can be cleared. */
const SURFACE_KINDS = SURFACE_SLOT_KINDS.surfaceStyle;

/**
 * The kinds that carry typography. The three context-gated Definitions render a
 * live string rather than an authored one, but they render it as text.
 */
const TYPOGRAPHY_KINDS = ['text', 'clock', 'player-life', 'game-wins'] as const;

/**
 * The kinds bounded by a Text Overflow Policy: the ones whose rendered string can
 * exceed its authored bounds. A Game Wins Item is absent because its `number`
 * display mode renders a win count, which cannot.
 */
const TEXT_OVERFLOW_KINDS = ['text', 'clock', 'player-life'] as const;

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
interface OwnedShapeGeometry {
	field: 'geometry' | 'clipGeometry' | 'boxGeometry';
	geometry: ShapeGeometry;
	/**
	 * The bounds the geometry is drawn inside, and where a preset that proposes a
	 * height writes it. Usually the item's own rectangle — but a Game Wins Item's
	 * geometry shapes one win box, so a preset sized against the whole indicator
	 * would be sized against the wrong thing.
	 */
	bounds: { width: number; height: number };
	heightField: 'height' | 'boxHeight';
}

function ownedShapeGeometry(item: GeometryOwner): OwnedShapeGeometry | null {
	const own = { bounds: { width: item.width, height: item.height }, heightField: 'height' } as const;
	if (item.type === 'media')
		return item.clipGeometry ? { field: 'clipGeometry', geometry: item.clipGeometry, ...own } : null;
	if (item.type === 'game-wins') {
		return {
			field: 'boxGeometry',
			geometry: item.boxGeometry,
			bounds: { width: item.boxWidth, height: item.boxHeight },
			heightField: 'boxHeight',
		};
	}
	return { field: 'geometry', geometry: item.geometry, ...own };
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
		const result = getShapeGeometryPreset(presetId).apply(owned.bounds);
		return result.height === undefined
			? { [owned.field]: result.geometry }
			: { [owned.field]: result.geometry, [owned.heightField]: result.height };
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
		mediaKind: GraphicMediaKind;
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

/** The Graphic Surface Style one item currently holds in one slot, if it has one. */
function surfaceStyleAt(
	item: GraphicItemConfig,
	slot: GraphicSurfaceStyleSlot,
): GraphicSurfaceStyle | undefined {
	if (slot === 'surfaceStyle')
		return 'surfaceStyle' in item ? item.surfaceStyle : undefined;
	return item.type === 'game-wins' ? item[slot] : undefined;
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
	slot: GraphicSurfaceStyleSlot = 'surfaceStyle',
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_SLOT_KINDS[slot], item => ({
		[slot]: { ...(surfaceStyleAt(item, slot) ?? createDefaultGraphicSurfaceStyle()), ...patch },
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
	slot: GraphicSurfaceStyleSlot = 'surfaceStyle',
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_SLOT_KINDS[slot], (item) => {
		const style = surfaceStyleAt(item, slot) ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type === kind)
			return { [slot]: style };

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

		return { [slot]: { ...style, fill } };
	});
}

/** Merge into a solid Graphic Fill. */
export function patchGraphicSolidFill(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	color: string,
	slot: GraphicSurfaceStyleSlot = 'surfaceStyle',
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_SLOT_KINDS[slot], (item) => {
		const style = surfaceStyleAt(item, slot) ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type !== 'solid')
			return { [slot]: style };
		return { [slot]: { ...style, fill: { type: 'solid', color } } };
	});
}

/** Merge into a linear-gradient Graphic Fill's angle. */
export function patchGraphicGradientAngle(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	angle: number,
	slot: GraphicSurfaceStyleSlot = 'surfaceStyle',
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_SLOT_KINDS[slot], (item) => {
		const style = surfaceStyleAt(item, slot) ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type !== 'linear-gradient')
			return { [slot]: style };
		return { [slot]: { ...style, fill: { ...style.fill, angle } } };
	});
}

/** Merge into one colour stop of a linear-gradient Graphic Fill. */
export function patchGraphicGradientStop(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	index: number,
	patch: Partial<GraphicFillStop>,
	slot: GraphicSurfaceStyleSlot = 'surfaceStyle',
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_SLOT_KINDS[slot], (item) => {
		const style = surfaceStyleAt(item, slot) ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type !== 'linear-gradient')
			return { [slot]: style };
		const stops = style.fill.stops.map((stop, position) =>
			position === index ? { ...stop, ...patch } : stop,
		);
		return { [slot]: { ...style, fill: { ...style.fill, stops } } };
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
	slot: GraphicSurfaceStyleSlot = 'surfaceStyle',
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_SLOT_KINDS[slot], (item) => {
		const style = surfaceStyleAt(item, slot) ?? createDefaultGraphicSurfaceStyle();
		if (style.fill.type !== 'linear-gradient')
			return { [slot]: style };

		const stops = [...style.fill.stops];
		if (delta === 1 && stops.length < 4) {
			const last = stops[stops.length - 1]!;
			stops.push({ ...last, position: 1 });
		}
		else if (delta === -1 && stops.length > 2) {
			stops.pop();
		}

		return { [slot]: { ...style, fill: { ...style.fill, stops } } };
	});
}

/** Merge into a Graphic Surface Style's uniform outline, or remove it. */
export function patchGraphicOutline(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicOutline> | null,
	slot: GraphicSurfaceStyleSlot = 'surfaceStyle',
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_SLOT_KINDS[slot], (item) => {
		const style = surfaceStyleAt(item, slot) ?? createDefaultGraphicSurfaceStyle();
		return {
			[slot]: {
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
	slot: GraphicSurfaceStyleSlot = 'surfaceStyle',
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, SURFACE_SLOT_KINDS[slot], (item) => {
		const style = surfaceStyleAt(item, slot) ?? createDefaultGraphicSurfaceStyle();
		return {
			[slot]: {
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

/**
 * Merge into an item's base typography, preserving every other field.
 *
 * Not only a Text Graphic Item's: a Clock, a Player Life, and a Game Wins Item
 * rendering its win count all paint text, and they read the string from the live
 * Feature Match Session rather than from an author. Where the string comes from
 * has no bearing on how it is set.
 */
export function patchGraphicTypography(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<GraphicTypography>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, TYPOGRAPHY_KINDS, item => ({
		typography: { ...item.typography, ...patch },
	}));
}

/**
 * Set the Text Overflow Policy, and the minimum font size a `shrink` policy
 * shrinks to, on any item whose rendered text can exceed its authored bounds.
 *
 * Text does not render with visible overflow beyond its authored bounds, and a
 * live string can be longer than the author ever saw — which is exactly why a
 * Clock and a Player Life need this as much as a Text Graphic Item does.
 */
export function patchGraphicTextOverflow(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: { overflowPolicy?: TextOverflowPolicy; minFontSize?: number },
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, TEXT_OVERFLOW_KINDS, () => patch);
}

/** Replace top-level properties of a Player Life Graphic Item, with its own type checked. */
export function patchPlayerLifeGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<Omit<PlayerLifeGraphicItemConfig, 'type' | 'id'>>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['player-life'], () => patch);
}

/** Replace top-level properties of a Game Wins Graphic Item, with its own type checked. */
export function patchGameWinsGraphicItem(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	patch: Partial<Omit<GameWinsGraphicItemConfig, 'type' | 'id'>>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ['game-wins'], () => patch);
}

/* ────────────────────────────────────────────────
 * Graphic Surface Style edits
 * ──────────────────────────────────────────────── */

/**
 * One edit to one Graphic Surface Style, as a value.
 *
 * The property controls for a surface are the same wherever a surface appears, but
 * which* surface they edit is not: a Game Wins Graphic Item has three, and every
 * one of them takes the same nine edits. Naming the edit rather than the nine
 * mutators is what lets one set of controls address any of them, and keeps the
 * slot the caller's decision rather than the control's.
 */
export type GraphicSurfaceStyleEdit
	= | { kind: 'present'; present: boolean }
		| { kind: 'fill-kind'; fillKind: GraphicFillKind }
		| { kind: 'solid-fill'; color: string }
		| { kind: 'gradient-angle'; angle: number }
		| { kind: 'gradient-stop'; index: number; patch: Partial<GraphicFillStop> }
		| { kind: 'stop-count'; delta: 1 | -1 }
		| { kind: 'fill-opacity'; fillOpacity: number }
		| { kind: 'outline'; patch: Partial<GraphicOutline> | null }
		| { kind: 'glow'; patch: Partial<GraphicGlow> | null };

/**
 * Apply one Graphic Surface Style edit to one slot of one Graphic Item.
 *
 * Clearing a surface is only meaningful where the slot is optional: a Game Wins
 * Item's win boxes always paint one, so `present: false` aimed at either of them
 * would author a shape the wire schema refuses, and is ignored.
 */
export function applyGraphicSurfaceStyleEdit(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	slot: GraphicSurfaceStyleSlot,
	edit: GraphicSurfaceStyleEdit,
): BroadcastGraphicConfig {
	switch (edit.kind) {
		case 'present':
			if (slot !== 'surfaceStyle')
				return graphic;
			return edit.present
				? patchGraphicSurfaceStyle(graphic, itemId, {})
				: clearGraphicSurfaceStyle(graphic, itemId);
		case 'fill-kind':
			return setGraphicFillKind(graphic, itemId, edit.fillKind, slot);
		case 'solid-fill':
			return patchGraphicSolidFill(graphic, itemId, edit.color, slot);
		case 'gradient-angle':
			return patchGraphicGradientAngle(graphic, itemId, edit.angle, slot);
		case 'gradient-stop':
			return patchGraphicGradientStop(graphic, itemId, edit.index, edit.patch, slot);
		case 'stop-count':
			return changeGraphicGradientStopCount(graphic, itemId, edit.delta, slot);
		case 'fill-opacity':
			return patchGraphicSurfaceStyle(graphic, itemId, { fillOpacity: edit.fillOpacity }, slot);
		case 'outline':
			return patchGraphicOutline(graphic, itemId, edit.patch, slot);
		case 'glow':
			return patchGraphicGlow(graphic, itemId, edit.patch, slot);
	}
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

	return patchGraphicItemGroup(graphic, itemId, GRAPHIC_GROUP_CHILD_KINDS, item => ({
		sizing: { mode: 'fixed', size: item.width, weight: 1, ...item.sizing, ...patch },
	}));
}

/* ────────────────────────────────────────────────
 * Graphic Animation
 * ──────────────────────────────────────────────── */

/**
 * A newly authored Broadcast Graphic or Graphic Item has no Graphic Animation
 * Recipes at all, so enabling a phase is what creates one and disabling it is
 * what removes it. These helpers keep that true in both directions: an animation
 * whose last recipe and stagger are gone is dropped entirely rather than left as
 * an empty object, so "has no recipes until its template author enables them"
 * stays a property of the stored shape rather than of how it is read.
 *
 * Every one of them is the same nested merge as the style and geometry helpers
 * above: editing one field of a channel never drops the channel's siblings, and
 * editing one channel never drops the recipe's other channels.
 */

/**
 * The recipe shape one lifecycle phase carries.
 *
 * Only the phase that cycles has a pause and a repetition, so a caller naming a
 * literal phase cannot aim those at a phase that would refuse them — the wire schema
 * rejects them there anyway, and a type that permits authoring something a write
 * refuses is a type that lets the editor build a control nobody can save. A caller
 * iterating every phase still compiles, because the conditional stays deferred until
 * the phase is known.
 */
export type GraphicAnimationRecipeFor<P extends GraphicAnimationPhase>
	= P extends 'on-screen' ? GraphicOnScreenAnimationRecipe : GraphicAnimationRecipe;

/** The channel a merge addresses. Each recipe holds at most one of each. */
export type GraphicAnimationChannelKey = 'fade' | 'slide' | 'scale' | 'reveal';

const GRAPHIC_ANIMATION_CHANNEL_DEFAULTS: {
	fade: GraphicFadeChannel;
	slide: GraphicSlideChannel;
	scale: GraphicScaleChannel;
	reveal: GraphicRevealChannel;
} = {
	fade: { opacity: 0 },
	slide: { direction: 'north', distanceMode: 'fixed', distance: 100 },
	scale: { factor: 0.8, origin: 'center' },
	reveal: { edge: 'left' },
};

/**
 * An animation with no recipes and no staggers left is no animation at all.
 *
 * The keys are deleted rather than set to undefined: this shape is persisted as
 * JSON, and an `undefined` value survives as a present key in every in-memory
 * comparison the editor and its tests make even though it vanishes on the wire.
 */
export function pruneGraphicAnimation<T extends GraphicContainerAnimation>(animation: T): T | undefined {
	const next = { ...animation };
	const hasRecipe = GRAPHIC_ANIMATION_PHASE_VALUES.some(phase => next[phase] !== undefined);
	const stagger = next.stagger;
	const hasStagger = stagger !== undefined
		&& GRAPHIC_ANIMATION_PHASE_VALUES.some(phase => stagger[phase] !== undefined);

	if (!hasStagger)
		delete next.stagger;
	if (!hasRecipe && !hasStagger)
		return undefined;
	return next;
}

/**
 * Enable or disable one lifecycle phase's recipe. Enabling with no recipe of its
 * own initialises the phase's editable default; passing null removes it.
 */
function setAnimationRecipe(
	animation: GraphicContainerAnimation | undefined,
	phase: GraphicAnimationPhase,
	recipe: GraphicAnimationRecipe | GraphicOnScreenAnimationRecipe | null,
): GraphicContainerAnimation | undefined {
	const next: GraphicContainerAnimation = { ...animation };
	if (recipe === null)
		delete next[phase];
	else
		next[phase] = recipe as never;

	return pruneGraphicAnimation(next);
}

/** Merge into one phase's recipe, initialising the phase's default if it has none. */
function mergeAnimationRecipe(
	animation: GraphicContainerAnimation | undefined,
	phase: GraphicAnimationPhase,
	patch: Partial<GraphicOnScreenAnimationRecipe>,
): GraphicContainerAnimation | undefined {
	const current = animation?.[phase] ?? createDefaultGraphicAnimationRecipe(phase);
	return setAnimationRecipe(animation, phase, { ...current, ...patch } as GraphicAnimationRecipe);
}

/** Merge into one channel of one phase's recipe, or remove that channel. */
function mergeAnimationChannel<K extends GraphicAnimationChannelKey>(
	animation: GraphicContainerAnimation | undefined,
	phase: GraphicAnimationPhase,
	channel: K,
	patch: Partial<typeof GRAPHIC_ANIMATION_CHANNEL_DEFAULTS[K]> | null,
): GraphicContainerAnimation | undefined {
	const current = animation?.[phase] ?? createDefaultGraphicAnimationRecipe(phase);
	const next = { ...current } as GraphicAnimationRecipe & Record<K, unknown>;

	if (patch === null)
		delete next[channel];
	else
		next[channel] = { ...GRAPHIC_ANIMATION_CHANNEL_DEFAULTS[channel], ...current[channel], ...patch };

	return setAnimationRecipe(animation, phase, next);
}

/** Merge into one phase's stagger, or remove it. Only a container carries one. */
function mergeAnimationStagger(
	animation: GraphicContainerAnimation | undefined,
	phase: GraphicAnimationPhase,
	patch: Partial<GraphicAnimationStagger> | null,
): GraphicContainerAnimation | undefined {
	const stagger = { ...animation?.stagger };
	if (patch === null) {
		delete stagger[phase];
	}
	else {
		stagger[phase] = {
			order: 'list',
			step: 100,
			itemIds: [],
			...stagger[phase],
			...patch,
		};
	}

	return pruneGraphicAnimation({ ...animation, stagger });
}

/** Drop one Graphic Item id from every stagger subset of one container. */
function withoutStaggeredItem(
	animation: GraphicContainerAnimation | undefined,
	itemId: string,
): GraphicContainerAnimation | undefined {
	if (!animation?.stagger)
		return animation;

	const stagger: NonNullable<GraphicContainerAnimation['stagger']> = {};
	for (const phase of GRAPHIC_ANIMATION_PHASE_VALUES) {
		const entry = animation.stagger[phase];
		if (!entry)
			continue;
		const itemIds = entry.itemIds.filter(id => id !== itemId);
		// A stagger emptied by a deletion is dropped rather than kept as an order
		// over nothing: the author selected a subset, they did not ask for an empty
		// one. An author who clears the subset by hand keeps their step and order,
		// because that is a choice rather than a consequence.
		if (itemIds.length === 0)
			continue;
		stagger[phase] = { ...entry, itemIds };
	}

	return pruneGraphicAnimation({ ...animation, stagger });
}

/** The kinds that may own a Graphic Animation: every Graphic Item kind. */
const ANIMATION_KINDS = ['text', 'shape', 'group'] as const;

/** Only a Graphic Group has direct Graphic Items of its own to stagger. */
const STAGGER_KINDS = ['group'] as const;

export function setGraphicItemAnimationRecipe(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	phase: GraphicAnimationPhase,
	recipe: GraphicAnimationRecipe | GraphicOnScreenAnimationRecipe | null,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ANIMATION_KINDS, item => ({
		animation: setAnimationRecipe(item.animation, phase, recipe),
	}));
}

/** Enable one lifecycle phase with its editable default recipe. */
export function enableGraphicItemAnimationPhase(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	phase: GraphicAnimationPhase,
): BroadcastGraphicConfig {
	return setGraphicItemAnimationRecipe(graphic, itemId, phase, createDefaultGraphicAnimationRecipe(phase));
}

/**
 * Merge into one phase's recipe.
 *
 * The patch type is keyed on the phase, so `pause` and `repeat` can only be aimed at
 * the phase that cycles. The wire schema rejects them elsewhere anyway — every
 * recipe object is strict — but a type that permits authoring something a write
 * refuses is a type that lets the editor build a control nobody can save.
 */
export function patchGraphicItemAnimationRecipe<P extends GraphicAnimationPhase>(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	phase: P,
	patch: Partial<GraphicAnimationRecipeFor<P>>,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ANIMATION_KINDS, item => ({
		animation: mergeAnimationRecipe(item.animation, phase, patch),
	}));
}

export function patchGraphicItemAnimationChannel<K extends GraphicAnimationChannelKey>(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	phase: GraphicAnimationPhase,
	channel: K,
	patch: Partial<typeof GRAPHIC_ANIMATION_CHANNEL_DEFAULTS[K]> | null,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, ANIMATION_KINDS, item => ({
		animation: mergeAnimationChannel(item.animation, phase, channel, patch),
	}));
}

/**
 * Initialise one phase's recipe from an animation preset. The preset writes an
 * ordinary editable recipe and nothing records which preset produced it.
 */
export function applyGraphicItemAnimationPreset(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	phase: GraphicAnimationPhase,
	presetId: string,
): BroadcastGraphicConfig {
	const preset = getGraphicAnimationPreset(presetId);
	if (!preset)
		return graphic;
	return setGraphicItemAnimationRecipe(graphic, itemId, phase, preset.create());
}

/** Merge into a Graphic Group's stagger of its own direct Graphic Items. */
export function patchGraphicItemAnimationStagger(
	graphic: BroadcastGraphicConfig,
	itemId: string,
	phase: GraphicAnimationPhase,
	patch: Partial<GraphicAnimationStagger> | null,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, itemId, STAGGER_KINDS, item => ({
		animation: mergeAnimationStagger(item.animation, phase, patch),
	}));
}

/** Add or remove one direct Graphic Item from a Graphic Group's staggered subset. */
export function toggleGraphicItemStaggerMember(
	graphic: BroadcastGraphicConfig,
	groupId: string,
	phase: GraphicAnimationPhase,
	memberId: string,
	selected: boolean,
): BroadcastGraphicConfig {
	return patchGraphicItemGroup(graphic, groupId, STAGGER_KINDS, (item) => {
		const current = item.animation?.stagger?.[phase]?.itemIds ?? [];
		const itemIds = selected
			? (current.includes(memberId) ? current : [...current, memberId])
			: current.filter(id => id !== memberId);
		return { animation: mergeAnimationStagger(item.animation, phase, { itemIds }) };
	});
}

/* Whole-graphic animation, over the Screen's stack. */

export function setBroadcastGraphicAnimationRecipe(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	phase: GraphicAnimationPhase,
	recipe: GraphicAnimationRecipe | GraphicOnScreenAnimationRecipe | null,
): BroadcastGraphicConfig[] {
	return graphics.map(entry => entry.id === graphicId
		? { ...entry, animation: setAnimationRecipe(entry.animation, phase, recipe) }
		: entry);
}

export function enableBroadcastGraphicAnimationPhase(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	phase: GraphicAnimationPhase,
): BroadcastGraphicConfig[] {
	return setBroadcastGraphicAnimationRecipe(graphics, graphicId, phase, createDefaultGraphicAnimationRecipe(phase));
}

export function patchBroadcastGraphicAnimationRecipe<P extends GraphicAnimationPhase>(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	phase: P,
	patch: Partial<GraphicAnimationRecipeFor<P>>,
): BroadcastGraphicConfig[] {
	return graphics.map(entry => entry.id === graphicId
		? { ...entry, animation: mergeAnimationRecipe(entry.animation, phase, patch) }
		: entry);
}

export function patchBroadcastGraphicAnimationChannel<K extends GraphicAnimationChannelKey>(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	phase: GraphicAnimationPhase,
	channel: K,
	patch: Partial<typeof GRAPHIC_ANIMATION_CHANNEL_DEFAULTS[K]> | null,
): BroadcastGraphicConfig[] {
	return graphics.map(entry => entry.id === graphicId
		? { ...entry, animation: mergeAnimationChannel(entry.animation, phase, channel, patch) }
		: entry);
}

export function applyBroadcastGraphicAnimationPreset(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	phase: GraphicAnimationPhase,
	presetId: string,
): BroadcastGraphicConfig[] {
	const preset = getGraphicAnimationPreset(presetId);
	if (!preset)
		return [...graphics];
	return setBroadcastGraphicAnimationRecipe(graphics, graphicId, phase, preset.create());
}

export function patchBroadcastGraphicAnimationStagger(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	phase: GraphicAnimationPhase,
	patch: Partial<GraphicAnimationStagger> | null,
): BroadcastGraphicConfig[] {
	return graphics.map(entry => entry.id === graphicId
		? { ...entry, animation: mergeAnimationStagger(entry.animation, phase, patch) }
		: entry);
}

export function toggleBroadcastGraphicStaggerMember(
	graphics: readonly BroadcastGraphicConfig[],
	graphicId: string,
	phase: GraphicAnimationPhase,
	memberId: string,
	selected: boolean,
): BroadcastGraphicConfig[] {
	return graphics.map((entry) => {
		if (entry.id !== graphicId)
			return entry;
		const current = entry.animation?.stagger?.[phase]?.itemIds ?? [];
		const itemIds = selected
			? (current.includes(memberId) ? current : [...current, memberId])
			: current.filter(id => id !== memberId);
		return { ...entry, animation: mergeAnimationStagger(entry.animation, phase, { itemIds }) };
	});
}
