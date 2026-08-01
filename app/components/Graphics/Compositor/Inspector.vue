<script setup lang="ts">
import type { GraphicsHostContract, GraphicSurfaceStyleEdit, GraphicSurfaceStyleSlot, ShapeGeometryPresetId } from '~~/shared/modules/graphics';
import type { Game, PlayerSide } from '~~/shared/types/enums';
import type { GraphicFocalPosition, MediaGraphicItemFit } from '~~/shared/types/graphicItem';
import type {
	BroadcastGraphicConfig,
	GameWinsBoxOrientation,
	GameWinsDisplayMode,
	GameWinsGraphicItemConfig,
	GraphicAnchorPoint,
	GraphicGeometryUnit,
	GraphicGroupChildSizing,
	GraphicGroupItemConfig,
	GraphicInputChoiceOption,
	GraphicInputDeclaration,
	GraphicInputType,
	GraphicItemConfig,
	GraphicPlaceholderStyle,
	GraphicSurfaceStyle,
	GraphicTypography,
	MediaGraphicItemConfig,
	OnAirUpdatePolicy,
	PlayerLifeAnimation,
	PlayerLifeGraphicItemConfig,
	ShapeCorner,
	ShapeCornerKey,
	ShapeGeometry,
	TEXT_OVERFLOW_POLICY_VALUES,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { GraphicStyleRef, GraphicStyleSlot } from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleAuthoringContext } from '~/composables/screen/useGraphicStyleSetAuthoring';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import {
	bindGraphicStyleRef,
	recaptureGraphicStyleOverrides,
	unbindGraphicStyleRef,
} from '~~/shared/modules/graphic-style-sets';
import {
	addGraphicInput,
	anchoredGraphicPosition,
	applyGraphicSurfaceStyleEdit,
	applyShapeGeometryPreset,
	authorsGraphicInputs,
	clearMediaGraphicItemAsset,
	DEFAULT_GRAPHIC_FONT_ID,
	deleteGraphicInput,
	displayGraphicGeometryValue,
	GRAPHIC_ANCHOR_POINTS,
	GRAPHIC_FONT_OPTIONS,
	graphicItemIcon,
	graphicItemKindLabel,
	graphicItemSummary,
	graphicsHostTokenCatalogue,
	graphicTextTemplateInputKeys,
	moveGraphicRectToAnchoredPosition,
	parseGraphicGeometryValue,
	patchBroadcastGraphic,
	patchGameWinsGraphicItem,
	patchGraphicGroup,
	patchGraphicGroupChildSizing,
	patchGraphicGroupDefaultChildSurfaceStyle,
	patchGraphicInput,
	patchGraphicItem,
	patchGraphicPlaceholderStyle,
	patchGraphicTextOverflow,
	patchGraphicTypography,
	patchMediaFocalPosition,
	patchMediaGraphicItem,
	patchPlayerLifeGraphicItem,
	patchShapeCorner,
	patchShapeGeometry,
	patchTextGraphicItem,
	replaceBroadcastGraphic,
	resizeGraphicRectFromAnchor,
	selectMediaGraphicItemAsset,
	setGraphicInputChoiceOptions,
	setMediaClipGeometry,
	SHAPE_GEOMETRY_PRESETS,
} from '~~/shared/modules/graphics';
import { MEDIA_GRAPHIC_ITEM_FIT_VALUES } from '~~/shared/types/graphicItem';
import {
	applicationGraphicFont,
	GAME_WINS_BOX_ORIENTATION_VALUES,
	GAME_WINS_DISPLAY_MODE_VALUES,
	GRAPHIC_FONT_STYLE_VALUES,
	GRAPHIC_GEOMETRY_UNIT_VALUES,
	GRAPHIC_GROUP_ALIGN_VALUES,
	GRAPHIC_GROUP_ARRANGEMENT_VALUES,
	GRAPHIC_GROUP_JUSTIFY_VALUES,
	GRAPHIC_INPUT_TYPE_VALUES,
	GRAPHIC_TEXT_ALIGN_VALUES,
	GRAPHIC_TEXT_TRANSFORM_VALUES,
	MAX_GRAPHIC_INPUT_CHOICE_OPTIONS,
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MAX_GRAPHIC_TEXT_LENGTH,
	MAX_PLAYER_LIFE_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_MEDIA_PLAYBACK_RATE,
	MIN_PLAYER_LIFE_ANIMATION_DURATION_MS,
	PLAYER_LIFE_ANIMATION_VALUES,
	SHAPE_CORNER_KEYS,
	SHAPE_CORNER_TREATMENT_VALUES,
} from '~~/shared/types/graphics';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';
import GraphicsCompositorAnimation from './Animation.vue';
import GraphicsCompositorBindings from './Bindings.vue';

/**
 * Property controls for the current selection: the Broadcast Graphic, or one
 * Graphic Item's geometry, Graphic Anchor Point, Graphic Surface Style, and
 * kind-specific properties. Geometry is authored in any Graphic Geometry Unit
 * and always stored as canonical canvas pixels.
 *
 * Every nested property group goes through its own merge helper, so editing one
 * field of a Shape Geometry, Graphic Fill, or typography never drops its siblings.
 *
 * A row or column Graphic Group child is positioned by its group rather than by
 * a coordinate, so it offers main-axis sizing instead of X, Y, and Graphic
 * Rotation. A canvas-positioned child offers all three, projected against its
 * group's own bounds.
 */
const props = defineProps<{
	graphics: readonly BroadcastGraphicConfig[];
	selectedTarget: GraphicsSelectionTarget;
	canvasWidth: number;
	canvasHeight: number;
	/**
	 * The embedding host's declaration. It decides where a Graphic Text Template's
	 * placeholder values come from, and therefore whether this panel offers controls
	 * to declare Graphic Inputs or a catalogue of host tokens to reference.
	 */
	contract: GraphicsHostContract;
	/** The Event whose Graphic Asset associations organise the asset picker's discovery. */
	eventId: number;
	/**
	 * The game of that Event, which decides which game-specific Graphic Input Binding
	 * catalog fields exist. Absent where the host has no Event context to read one
	 * from, and the catalog's lenient case covers it.
	 */
	game?: Game;
	/**
	 * The published Graphic Style Set this composition is linked to, when it is
	 * linked to one.
	 *
	 * Absent means every property here is local, and no picker appears at all. That
	 * is the unlinked case and also the failure case — a Style Set that could not be
	 * loaded leaves the properties exactly as they are rather than offering entries
	 * that might not be the ones the composition was authored against.
	 */
	styleSet?: GraphicStyleAuthoringContext;
	/**
	 * Whether this session may author the selection. A session observing an artifact
	 * another session's Graphics Authoring Lease covers reads every property and
	 * changes none.
	 */
	writable?: boolean;
}>();

const emit = defineEmits<{ 'update:graphics': [graphics: BroadcastGraphicConfig[]] }>();

/**
 * Fail closed: a caller that does not grant authoring gets a read-only editor.
 * Only a session confirmed to hold the artifact's Graphics Authoring Lease authors
 * it, so an absent prop must never read as permission.
 */
const canAuthor = computed(() => props.writable === true);

const geometryUnit = ref<GraphicGeometryUnit>('px');

const GEOMETRY_UNIT_OPTIONS = GRAPHIC_GEOMETRY_UNIT_VALUES.map(unit => ({
	label: unit === 'px' ? 'px' : unit === 'percent' ? '%' : 'grid',
	value: unit,
}));
const ANCHOR_OPTIONS = GRAPHIC_ANCHOR_POINTS.map(point => ({ label: point.label, value: point.value }));
const OVERFLOW_POLICY_OPTIONS = [
	{ label: 'Clip', value: 'clip' },
	{ label: 'Ellipsis', value: 'ellipsis' },
	{ label: 'Shrink then ellipsis', value: 'shrink' },
] satisfies Array<{ label: string; value: typeof TEXT_OVERFLOW_POLICY_VALUES[number] }>;
const TEXT_ALIGN_OPTIONS = GRAPHIC_TEXT_ALIGN_VALUES.map(value => ({ label: value, value }));
const TEXT_TRANSFORM_OPTIONS = GRAPHIC_TEXT_TRANSFORM_VALUES.map(value => ({ label: value, value }));
const FONT_STYLE_OPTIONS = GRAPHIC_FONT_STYLE_VALUES.map(value => ({ label: value, value }));
const CORNER_TREATMENT_OPTIONS = SHAPE_CORNER_TREATMENT_VALUES.map(value => ({ label: value, value }));
const PLAYER_LIFE_ANIMATION_OPTIONS = PLAYER_LIFE_ANIMATION_VALUES.map(value => ({ label: value, value }));
const GAME_WINS_DISPLAY_MODE_OPTIONS = GAME_WINS_DISPLAY_MODE_VALUES.map(value => ({ label: value, value }));
const GAME_WINS_BOX_ORIENTATION_OPTIONS = GAME_WINS_BOX_ORIENTATION_VALUES.map(value => ({ label: value, value }));
const MEDIA_FIT_OPTIONS = MEDIA_GRAPHIC_ITEM_FIT_VALUES.map(value => ({ label: value, value }));
const GEOMETRY_PRESET_OPTIONS = SHAPE_GEOMETRY_PRESETS.map(preset => ({
	label: preset.label,
	value: preset.id,
	icon: preset.icon,
}));
const ARRANGEMENT_OPTIONS = GRAPHIC_GROUP_ARRANGEMENT_VALUES.map(value => ({ label: value, value }));
const ALIGN_OPTIONS = GRAPHIC_GROUP_ALIGN_VALUES.map(value => ({ label: value, value }));
const JUSTIFY_OPTIONS = GRAPHIC_GROUP_JUSTIFY_VALUES.map(value => ({ label: value, value }));
const SIZING_MODE_OPTIONS = [
	{ label: 'Fixed', value: 'fixed' },
	{ label: 'Weighted fill', value: 'fill' },
] satisfies Array<{ label: string; value: GraphicGroupChildSizing['mode'] }>;
const CORNER_LABELS: Record<ShapeCornerKey, string> = {
	topLeft: 'Top left',
	topRight: 'Top right',
	bottomRight: 'Bottom right',
	bottomLeft: 'Bottom left',
};

const selection = computed(() => resolveGraphicsSelection(props.graphics, props.selectedTarget));

const header = computed(() => {
	const current = selection.value;
	if (current.kind === 'canvas') {
		return {
			icon: 'i-lucide-panels-top-left',
			label: 'Canvas',
			badge: 'Screen',
			summary: `${props.canvasWidth}x${props.canvasHeight} Broadcast Graphics canvas`,
		};
	}
	if (current.kind === 'graphic') {
		return {
			icon: 'i-lucide-layers',
			label: current.graphic.name,
			badge: 'Broadcast Graphic',
			summary: `${current.graphic.items.length} Graphic Items`,
		};
	}
	if (current.kind === 'item') {
		return {
			icon: graphicItemIcon(current.item.type),
			label: current.item.label,
			badge: graphicItemKindLabel(current.item.type),
			summary: graphicItemSummary(current.item),
		};
	}
	return {
		icon: 'i-lucide-circle-help',
		label: 'Selection unavailable',
		badge: 'Missing',
		summary: 'Choose another Broadcast Graphic or Graphic Item',
	};
});

const selectedItem = computed(() => selection.value.kind === 'item' ? selection.value.item : null);
const parentGroup = computed<GraphicGroupItemConfig | null>(() =>
	selection.value.kind === 'item' ? selection.value.group ?? null : null,
);
const selectedTextItem = computed<TextGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'text' ? selectedItem.value : null,
);
const selectedMediaItem = computed<MediaGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'media' ? selectedItem.value : null,
);
const selectedGroup = computed<GraphicGroupItemConfig | null>(() =>
	selectedItem.value?.type === 'group' ? selectedItem.value : null,
);
const selectedPlayerLife = computed<PlayerLifeGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'player-life' ? selectedItem.value : null,
);
const selectedGameWins = computed<GameWinsGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'game-wins' ? selectedItem.value : null,
);

/**
 * The base typography of whatever the selection paints text with.
 *
 * A Clock, a Player Life, and a Game Wins Item rendering its win count all paint
 * text; they read the string from the live Feature Match Session rather than from
 * an author, which decides what the item says and nothing about how it is set. So
 * one typography block serves all four kinds rather than one per kind.
 *
 * A Game Wins Item paints text only in its `number` display mode; in `boxes` it
 * paints boxes, and offering typography there would be a whole block of controls
 * that change nothing on screen.
 */
const selectedTypography = computed<GraphicTypography | null>(() => {
	const item = selectedItem.value;
	if (!item || item.type === 'shape' || item.type === 'media' || item.type === 'group')
		return null;
	if (item.type === 'game-wins')
		return item.displayMode === 'number' ? item.typography : null;
	return item.typography;
});

/**
 * The Text Overflow Policy of a selection whose rendered text can exceed its
 * authored bounds. A live string can be longer than the author ever saw, which is
 * exactly why a Clock and a Player Life are bounded like a Text Graphic Item.
 */
const selectedTextOverflow = computed(() => {
	const item = selectedItem.value;
	if (item?.type !== 'text' && item?.type !== 'clock' && item?.type !== 'player-life')
		return null;
	return { overflowPolicy: item.overflowPolicy, minFontSize: item.minFontSize };
});

/**
 * The Player a context-gated Graphic Item reads.
 *
 * Its own control rather than part of the shared geometry block, because it is
 * the only property of these kinds that decides *whose* live state renders — a
 * Player Life fixed to `player1` makes a two-player overlay unbuildable, because
 * both sides would show the same total.
 */
const selectedPlayerSide = computed<PlayerSide | null>(() => {
	const item = selectedItem.value;
	return item?.type === 'player-life' || item?.type === 'game-wins' ? item.playerSide : null;
});

const PLAYER_SIDE_OPTIONS = [
	{ label: 'Player 1', value: 'player1' },
	{ label: 'Player 2', value: 'player2' },
] satisfies Array<{ label: string; value: PlayerSide }>;

function updatePlayerSide(playerSide: PlayerSide) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicItem(graphic, itemId, { playerSide }));
}

/**
 * The Shape Geometry the geometry controls edit.
 *
 * A Shape Graphic Item and a Graphic Group draw one and always have one. A Media
 * Graphic Item clips to one only while clipping is switched on, so the same
 * controls appear for it exactly when there is a clip to shape. A Game Wins Item's
 * is the shape of one win box: a cut-corner win box is authored with exactly the
 * controls a Shape Graphic Item uses.
 */
const selectedGeometry = computed<ShapeGeometry | null>(() => {
	const item = selectedItem.value;
	if (item?.type === 'shape' || item?.type === 'group')
		return item.geometry;
	if (item?.type === 'media')
		return item.clipGeometry ?? null;
	// Offered only while boxes are what renders. A `number` display mode paints a
	// win count, which has no box to shape — and the authored geometry survives the
	// switch, so going back restores what the author already set up.
	if (item?.type === 'game-wins')
		return item.displayMode === 'boxes' ? item.boxGeometry : null;
	return null;
});

/** Named for what it shapes, because a Game Wins Item's geometry is not its own bounds. */
const geometryTitle = computed(() =>
	selectedItem.value?.type === 'game-wins' ? 'Win box Shape Geometry' : 'Shape Geometry',
);

/** Only a canvas-positioned item has a coordinate and a Graphic Rotation. */
const isCanvasPositioned = computed(() =>
	selectedItem.value !== null && (parentGroup.value === null || parentGroup.value.arrangement === 'canvas'),
);
const isStackedChild = computed(() =>
	parentGroup.value !== null && parentGroup.value.arrangement !== 'canvas',
);

/**
 * Only an item's own Graphic Surface Style is editable here. A Graphic Group
 * child with none of its own inherits the group's local style default, which is
 * edited on the group itself.
 *
 * A Media Graphic Item never has one: fill, outline, and glow belong to the kinds
 * that paint a surface, and it paints an asset.
 */
const ownSurfaceStyle = computed<GraphicSurfaceStyle | null>(() => {
	const item = selectedItem.value;
	if (!item || item.type === 'media')
		return null;
	return item.surfaceStyle ?? null;
});

/**
 * Apply one Graphic Surface Style edit to one of the selection's surfaces.
 *
 * Which surface is this panel's decision rather than the controls': a Game Wins
 * Item has three, and the controls for all three are identical.
 */
function applySurfaceStyleEdit(slot: GraphicSurfaceStyleSlot, edit: GraphicSurfaceStyleEdit) {
	applyToSelectedGraphic((graphic, itemId) => applyGraphicSurfaceStyleEdit(graphic, itemId, slot, edit));
}

/** A Graphic Geometry Unit projects against the containing canvas — a Graphic Group for its children. */
function axisTotal(axis: 'x' | 'y') {
	const group = parentGroup.value;
	if (group)
		return axis === 'x' ? group.width : group.height;
	return axis === 'x' ? props.canvasWidth : props.canvasHeight;
}

const anchoredPosition = computed(() => selectedItem.value
	? anchoredGraphicPosition(selectedItem.value, selectedItem.value.anchor)
	: { x: 0, y: 0 });

function displayedPosition(axis: 'x' | 'y') {
	return displayGraphicGeometryValue(anchoredPosition.value[axis], axisTotal(axis), geometryUnit.value, true);
}

function displayedSize(axis: 'width' | 'height') {
	const item = selectedItem.value;
	if (!item)
		return 0;
	return displayGraphicGeometryValue(item[axis], axisTotal(axis === 'width' ? 'x' : 'y'), geometryUnit.value);
}

/**
 * One edited Broadcast Graphic, with its Graphic Style Set overrides brought back
 * into line with what it now holds.
 *
 * This is the single place a property edit becomes an explicit property-level
 * override. The controls below write *values* — an author drags a font size on an
 * item whose typography is inherited — and nothing about them knows about
 * provenance. Re-deriving the deviations here means every control participates
 * without any of them being taught to, and an author who edits a value and puts it
 * back is left with no override rather than one pinning it.
 *
 * With no Style Set loaded it is the identity, so an unlinked composition is
 * untouched.
 */
function withRecapturedStyleOverrides(graphic: BroadcastGraphicConfig): BroadcastGraphicConfig {
	const context = props.styleSet;
	return context
		? recaptureGraphicStyleOverrides(graphic, context.resolution, context.publishedRevision)
		: graphic;
}

function patchSelectedItem(patch: Partial<GraphicItemConfig>) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'item')
		return;
	emit('update:graphics', replaceBroadcastGraphic(
		props.graphics,
		withRecapturedStyleOverrides(patchGraphicItem(current.graphic, current.item.id, patch)),
	));
}

/**
 * Which Shape Geometry the geometry controls are editing, named as a Graphic Style
 * Set slot.
 *
 * Three kinds keep one in three different places — a Shape Graphic Item and a
 * Graphic Group draw their own, a Media Graphic Item clips to one, and a Game Wins
 * Graphic Item shapes a win box with one — and `selectedGeometry` already resolves
 * all three into one set of controls. This is the same resolution stated as a slot,
 * so the picker above those controls inherits into whichever geometry they edit
 * rather than into whichever one happens to be named first.
 */
const geometryStyleSlot = computed<GraphicStyleSlot>(() => {
	switch (selectedItem.value?.type) {
		case 'media':
			return 'clipGeometry';
		case 'game-wins':
			return 'boxGeometry';
		default:
			return 'geometry';
	}
});

/** The Graphic Style Set entry one slot of the selected Graphic Item follows. */
function styleRefFor(slot: GraphicStyleSlot): GraphicStyleRef | undefined {
	return selectedItem.value?.styleRefs?.[slot];
}

function bindStyleRef(slot: GraphicStyleSlot, entryId: string) {
	const current = selection.value;
	const context = props.styleSet;
	if (!canAuthor.value || current.kind !== 'item' || !context)
		return;
	emit('update:graphics', replaceBroadcastGraphic(
		props.graphics,
		bindGraphicStyleRef(current.graphic, current.item.id, slot, entryId, context.resolution),
	));
}

function unbindStyleRef(slot: GraphicStyleSlot) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'item')
		return;
	emit('update:graphics', replaceBroadcastGraphic(
		props.graphics,
		unbindGraphicStyleRef(current.graphic, current.item.id, slot),
	));
}

function updatePosition(axis: 'x' | 'y', value: number | null | undefined) {
	const item = selectedItem.value;
	if (!item)
		return;
	const pixels = parseGraphicGeometryValue(value ?? 0, axisTotal(axis), geometryUnit.value, true);
	patchSelectedItem(moveGraphicRectToAnchoredPosition(item, axis, pixels, item.anchor));
}

function updateSize(axis: 'width' | 'height', value: number | null | undefined) {
	const item = selectedItem.value;
	if (!item)
		return;
	const pixels = parseGraphicGeometryValue(
		value ?? 0,
		axisTotal(axis === 'width' ? 'x' : 'y'),
		geometryUnit.value,
	);
	patchSelectedItem(resizeGraphicRectFromAnchor(item, { [axis]: Math.max(1, pixels) }, item.anchor));
}

/** Nested property groups go through their own merge, so a single-field edit keeps its siblings. */
function applyToSelectedGraphic(
	merge: (graphic: BroadcastGraphicConfig, itemId: string) => BroadcastGraphicConfig,
) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'item')
		return;
	emit('update:graphics', replaceBroadcastGraphic(
		props.graphics,
		withRecapturedStyleOverrides(merge(current.graphic, current.item.id)),
	));
}

function updateTypography(patch: Partial<GraphicTypography>) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicTypography(graphic, itemId, patch));
}

/** The two arms of a Graphic Font Selection, as an author picks between them. */
const FONT_SOURCE_OPTIONS = [
	{ label: 'Application font', value: 'application' },
	{ label: 'Library font', value: 'asset' },
];

/**
 * Which arm the author is editing, when the stored selection cannot say.
 *
 * An override rather than a second source of truth: the stored selection decides,
 * and this only holds the one case it cannot express — an author who has chosen
 * "Library font" but not yet pinned a revision. Writing the asset arm at that
 * moment would store a typography whose font is nothing, so the item keeps the
 * application font it has until the picker pins one. Cleared whenever the
 * selection moves, so the control never describes the previous item's font.
 */
const fontSourceOverride = ref<'application' | 'asset'>();
const selectedFont = computed(() => selectedTypography.value?.font);
const fontSource = computed(() => fontSourceOverride.value ?? selectedFont.value?.kind ?? 'application');
const selectedFontAsset = computed(() =>
	selectedFont.value?.kind === 'asset' ? selectedFont.value.reference : undefined,
);

watch(selection, () => {
	fontSourceOverride.value = undefined;
});

function updateFontSource(source: 'application' | 'asset') {
	fontSourceOverride.value = source;
	if (source === 'application' && selectedFont.value?.kind === 'asset')
		updateTypography({ font: applicationGraphicFont(DEFAULT_GRAPHIC_FONT_ID) });
}

/** Pin one exact font Graphic Asset Revision, as a Media Graphic Item pins content. */
function selectFontAsset(_asset: GraphicAsset, reference: GraphicAssetReference) {
	updateTypography({ font: { kind: 'asset', reference } });
}

/** Unpinning a library font leaves the item on an application font rather than none. */
function clearFontAsset() {
	updateTypography({ font: applicationGraphicFont(DEFAULT_GRAPHIC_FONT_ID) });
}

function updateGeometry(patch: Partial<ShapeGeometry>) {
	applyToSelectedGraphic((graphic, itemId) => patchShapeGeometry(graphic, itemId, patch));
}

function updateCorner(corner: ShapeCornerKey, patch: Partial<ShapeCorner>) {
	applyToSelectedGraphic((graphic, itemId) => patchShapeCorner(graphic, itemId, corner, patch));
}

function applyPreset(presetId: ShapeGeometryPresetId) {
	applyToSelectedGraphic((graphic, itemId) => applyShapeGeometryPreset(graphic, itemId, presetId));
}

function updateGroup(patch: Partial<Omit<GraphicGroupItemConfig, 'type' | 'id' | 'children'>>) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGroup(graphic, itemId, patch));
}

function updateDefaultChildStyle(patch: Partial<GraphicSurfaceStyle> | null) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGroupDefaultChildSurfaceStyle(graphic, itemId, patch));
}

function updateChildSizing(patch: Partial<GraphicGroupChildSizing>) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicGroupChildSizing(graphic, itemId, patch));
}

function updateTextItem(patch: Partial<Omit<TextGraphicItemConfig, 'type' | 'id'>>) {
	applyToSelectedGraphic((graphic, itemId) => patchTextGraphicItem(graphic, itemId, patch));
}

/** Shared by every kind whose rendered text can exceed its authored bounds. */
function updateTextOverflow(patch: { overflowPolicy?: TextGraphicItemConfig['overflowPolicy']; minFontSize?: number }) {
	applyToSelectedGraphic((graphic, itemId) => patchGraphicTextOverflow(graphic, itemId, patch));
}

function updatePlayerLifeItem(patch: Partial<Omit<PlayerLifeGraphicItemConfig, 'type' | 'id'>>) {
	applyToSelectedGraphic((graphic, itemId) => patchPlayerLifeGraphicItem(graphic, itemId, patch));
}

function updateGameWinsItem(patch: Partial<Omit<GameWinsGraphicItemConfig, 'type' | 'id'>>) {
	applyToSelectedGraphic((graphic, itemId) => patchGameWinsGraphicItem(graphic, itemId, patch));
}

function updateMediaItem(patch: Partial<Omit<MediaGraphicItemConfig, 'type' | 'id'>>) {
	applyToSelectedGraphic((graphic, itemId) => patchMediaGraphicItem(graphic, itemId, patch));
}

function updateFocalPosition(patch: Partial<GraphicFocalPosition>) {
	applyToSelectedGraphic((graphic, itemId) => patchMediaFocalPosition(graphic, itemId, patch));
}

function updateMediaClipping(clipping: boolean) {
	applyToSelectedGraphic((graphic, itemId) => setMediaClipGeometry(graphic, itemId, clipping));
}

/**
 * Pin one exact Graphic Asset identity and revision. The asset's own kind decides
 * the item's media kind, and a silent video also records the revision's target
 * compatibility, so the reference index has the fact it checks against.
 */
function selectMediaAsset(asset: GraphicAsset, reference: GraphicAssetReference) {
	applyToSelectedGraphic((graphic, itemId) => selectMediaGraphicItemAsset(graphic, itemId, {
		asset: reference,
		mediaKind: asset.kind === 'silent-video' ? 'silent-video' : 'image',
		videoCompatibility: asset.facts.kind === 'silent-video' ? asset.facts.targetCompatibility : undefined,
	}));
}

function clearMediaAsset() {
	applyToSelectedGraphic((graphic, itemId) => clearMediaGraphicItemAsset(graphic, itemId));
}

function updateGraphicName(value: string) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'graphic')
		return;
	emit('update:graphics', patchBroadcastGraphic(props.graphics, current.graphic.id, { name: value }));
}

/* ────────────────────────────────────────────────
 * Graphic Inputs
 * ──────────────────────────────────────────────── */

/**
 * The typed Graphic Inputs the selected Broadcast Graphic declares.
 *
 * They belong to the graphic rather than to any one Graphic Item, because a
 * `{inputKey}` placeholder in any of its Text Graphic Items may name the same
 * input — so this panel appears with the Broadcast Graphic selected.
 */
const selectedGraphicInputs = computed<GraphicInputDeclaration[]>(() =>
	selection.value.kind === 'graphic' ? selection.value.graphic.inputs ?? [] : [],
);

/**
 * Whether this host's compositions declare their own Graphic Inputs.
 *
 * A host binding host tokens must never see these controls: its catalogue is
 * fixed, so an author cannot add, rename, or delete an entry, and offering the
 * controls anyway would let one write a declaration nothing resolves.
 */
const authorsInputs = computed(() => authorsGraphicInputs(props.contract));

/**
 * The placeholder keys this host supplies itself, empty when the composition
 * declares its own. A Feature Match Overlay's Graphic Text Templates name exactly
 * these and nothing else.
 */
const hostTokens = computed(() => graphicsHostTokenCatalogue(props.contract));

/**
 * Every placeholder key the selected Graphic Item's template may name, whichever
 * side supplies them. One list rather than two branches at each use, because the
 * question a placeholder asks — "does anything resolve this key?" — has one answer
 * however the host answers it.
 */
const availablePlaceholderKeys = computed<string[]>(() => {
	if (!authorsInputs.value)
		return hostTokens.value.map(token => token.key);

	const current = selection.value;
	if (current.kind !== 'graphic' && current.kind !== 'item')
		return [];
	return (current.graphic.inputs ?? []).map(input => input.key);
});

const INPUT_TYPE_OPTIONS = GRAPHIC_INPUT_TYPE_VALUES.map(value => ({ label: value, value }));
const UPDATE_POLICY_OPTIONS = [
	{ label: 'Staged', value: 'staged' },
	{ label: 'Live', value: 'live' },
] satisfies Array<{ label: string; value: OnAirUpdatePolicy }>;

function applyToGraphicInputs(
	merge: (graphics: readonly BroadcastGraphicConfig[], graphicId: string) => BroadcastGraphicConfig[],
) {
	const current = selection.value;
	if (!canAuthor.value || current.kind !== 'graphic')
		return;
	emit('update:graphics', merge(props.graphics, current.graphic.id));
}

const newInputType = ref<GraphicInputType>('text');

/** A Graphic Input key written the way a Graphic Text Template names it. */
function placeholderToken(key: string): string {
	return `{${key}}`;
}

/**
 * Append one host token to the selected Text Graphic Item's template.
 *
 * Appending rather than inserting at a caret: the textarea is bound to the model
 * rather than held as a ref, so there is no caret this component owns. Bounded by
 * the same maximum the field enforces, so a click can never write a template a
 * direct edit would have refused.
 */
function appendHostToken(key: string) {
	const item = selectedTextItem.value;
	if (!canAuthor.value || !item)
		return;

	const next = `${item.text}${placeholderToken(key)}`;
	if (next.length <= MAX_GRAPHIC_TEXT_LENGTH)
		updateTextItem({ text: next });
}

function addInput() {
	applyToGraphicInputs((graphics, graphicId) => addGraphicInput(graphics, graphicId, newInputType.value));
}

/**
 * Merge into one Graphic Input declaration, ignoring a blank label.
 *
 * The write path requires a label of at least one character, so clearing the field
 * writes nothing at all and the previous name stands until another is typed. The
 * operation refuses one too; this is the half that keeps a cleared field from writing
 * the Screen's mode configuration unchanged.
 */
function updateInput(key: string, patch: Partial<Omit<GraphicInputDeclaration, 'key' | 'type'>>) {
	if (patch.label !== undefined && patch.label.trim() === '')
		return;
	applyToGraphicInputs((graphics, graphicId) => patchGraphicInput(graphics, graphicId, key, patch));
}

function removeInput(key: string) {
	applyToGraphicInputs((graphics, graphicId) => deleteGraphicInput(graphics, graphicId, key));
}

function updateChoiceOptions(key: string, options: GraphicInputChoiceOption[]) {
	applyToGraphicInputs((graphics, graphicId) => setGraphicInputChoiceOptions(graphics, graphicId, key, options));
}

/**
 * A choice Graphic Input's options as one line per option, `value=label`.
 *
 * A bounded list of short pairs is exactly what a textarea is good at, and it
 * keeps the option list one control rather than a nested editor inside a property
 * panel.
 */
function choiceOptionsText(input: GraphicInputDeclaration): string {
	return input.type === 'choice'
		? input.options.map(option => `${option.value}=${option.label}`).join('\n')
		: '';
}

function parseChoiceOptions(key: string, value: string) {
	const options = value
		.split('\n')
		.map(line => line.trim())
		.filter(line => line.length > 0)
		.map((line) => {
			const [optionValue, ...rest] = line.split('=');
			const trimmed = (optionValue ?? '').trim();
			return { value: trimmed, label: rest.join('=').trim() || trimmed };
		})
		.filter(option => option.value.length > 0);

	updateChoiceOptions(key, options.slice(0, MAX_GRAPHIC_INPUT_CHOICE_OPTIONS));
}

/* ────────────────────────────────────────────────
 * Graphic Placeholder Styles
 * ──────────────────────────────────────────────── */

/**
 * The `{inputKey}` placeholders of the selected Text Graphic Item that something
 * actually resolves — a declared Graphic Input, or a token this host supplies.
 *
 * Only resolvable ones: styling a placeholder nothing resolves would be styling
 * something that renders nothing. Asking `availablePlaceholderKeys` rather than the
 * graphic's own declarations is what makes a Feature Match Overlay's `{player1Name}`
 * styleable at all — it is a host token, so no Graphic Input declares it.
 */
const styleablePlaceholders = computed(() => {
	const current = selection.value;
	if (current.kind !== 'item' || current.item.type !== 'text')
		return [];

	const available = new Set(availablePlaceholderKeys.value);
	return graphicTextTemplateInputKeys(current.item.text).filter(key => available.has(key));
});

function placeholderStyleFor(inputKey: string): GraphicPlaceholderStyle {
	return selectedTextItem.value?.placeholderStyles?.[inputKey] ?? {};
}

function updatePlaceholderStyle(inputKey: string, patch: Partial<GraphicPlaceholderStyle> | null) {
	applyToSelectedGraphic((graphic, itemId) =>
		patchGraphicPlaceholderStyle(graphic, itemId, inputKey, patch),
	);
}
</script>

<template>
	<!--
		A disabled fieldset is what makes the read-only editor read-only in the
		browser rather than merely discouraging: every native control it contains
		stops accepting input. The guards above are the same rule stated where a
		programmatic change would otherwise slip through.
	-->
	<fieldset class="min-w-0 space-y-4" :disabled="!canAuthor">
		<div class="border-b border-default/70 pb-3">
			<div class="flex min-w-0 items-start gap-3">
				<UIcon :name="header.icon" class="mt-0.5 size-5 shrink-0 text-muted" />
				<div class="min-w-0 flex-1">
					<div class="flex min-w-0 flex-wrap items-center gap-2">
						<p class="truncate text-sm font-semibold">
							{{ header.label }}
						</p>
						<UBadge size="xs" variant="soft">
							{{ header.badge }}
						</UBadge>
					</div>
					<p class="mt-0.5 truncate text-xs text-muted">
						{{ header.summary }}
					</p>
				</div>
			</div>
		</div>

		<UFormField v-if="selection.kind === 'graphic'" label="Name" size="sm">
			<UInput
				:model-value="selection.graphic.name"
				class="w-full"
				data-testid="broadcast-graphic-name"
				@update:model-value="updateGraphicName(String($event))"
			/>
		</UFormField>

		<!--
			Graphic Inputs belong to the Broadcast Graphic, not to one Graphic Item: any
			of its Text Graphic Items may name the same `{inputKey}`.

			Offered only where the host's compositions declare their own. A host binding
			a fixed token catalogue has nothing here to author, and showing the controls
			anyway would let an author write a declaration nothing resolves.
		-->
		<template v-if="selection.kind === 'graphic' && authorsInputs">
			<div class="flex items-end gap-2">
				<UFormField label="Graphic Inputs" size="sm" class="flex-1">
					<USelect
						:model-value="newInputType"
						:items="INPUT_TYPE_OPTIONS"
						class="w-full"
						size="sm"
						data-testid="graphic-input-type"
						@update:model-value="newInputType = $event"
					/>
				</UFormField>
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-plus"
					data-testid="graphic-input-add"
					@click="addInput()"
				>
					Declare
				</UButton>
			</div>

			<div
				v-for="input in selectedGraphicInputs"
				:key="input.key"
				class="space-y-2 rounded-lg border border-default/70 p-2"
				:data-graphic-input-declaration="input.key"
			>
				<div class="flex items-center gap-2">
					<UInput
						:model-value="input.label"
						class="min-w-0 flex-1"
						size="sm"
						:maxlength="MAX_GRAPHIC_INPUT_LABEL_LENGTH"
						data-testid="graphic-input-label"
						@update:model-value="updateInput(input.key, { label: String($event) })"
					/>
					<UBadge size="xs" variant="soft">
						{{ input.type }}
					</UBadge>
					<UButton
						size="xs"
						variant="ghost"
						color="error"
						icon="i-lucide-trash-2"
						aria-label="Stop declaring this Graphic Input"
						data-testid="graphic-input-delete"
						@click="removeInput(input.key)"
					/>
				</div>

				<!--
					The key is generated once and never edited: a placeholder, a binding, a
					Graphic Placeholder Style, and every accepted value in a running Live
					Session all name it. The label is what an author renames.
				-->
				<p class="font-mono text-xs text-muted" data-testid="graphic-input-key">
					{{ placeholderToken(input.key) }}
				</p>

				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Required" size="xs">
						<USwitch
							:model-value="input.required"
							size="sm"
							data-testid="graphic-input-required"
							@update:model-value="updateInput(input.key, { required: Boolean($event) })"
						/>
					</UFormField>
					<UFormField label="On-air Update Policy" size="xs">
						<USelect
							:model-value="input.updatePolicy"
							:items="UPDATE_POLICY_OPTIONS"
							class="w-full"
							size="sm"
							data-testid="graphic-input-policy"
							@update:model-value="updateInput(input.key, { updatePolicy: $event })"
						/>
					</UFormField>
				</div>

				<UFormField v-if="input.type === 'text'" label="Default" size="xs">
					<UInput
						:model-value="input.default"
						class="w-full"
						size="sm"
						:maxlength="input.maxLength"
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: String($event) })"
					/>
				</UFormField>
				<UFormField v-else-if="input.type === 'number'" label="Default" size="xs">
					<UInputNumber
						:model-value="input.default ?? undefined"
						class="w-full"
						size="sm"
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: $event ?? null })"
					/>
				</UFormField>
				<UFormField v-else-if="input.type === 'toggle'" label="Default" size="xs">
					<USwitch
						:model-value="input.default"
						size="sm"
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: Boolean($event) })"
					/>
				</UFormField>
				<UFormField v-else-if="input.type === 'color'" label="Default" size="xs">
					<UInput
						type="color"
						:model-value="input.default ?? '#000000'"
						size="sm"
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: String($event) })"
					/>
				</UFormField>

				<UFormField
					v-if="input.type === 'choice'"
					label="Options"
					size="xs"
					:help="`One per line, as value=label. Up to ${MAX_GRAPHIC_INPUT_CHOICE_OPTIONS}.`"
				>
					<UTextarea
						:model-value="choiceOptionsText(input)"
						class="w-full"
						size="sm"
						:rows="3"
						data-testid="graphic-input-options"
						@update:model-value="parseChoiceOptions(input.key, String($event))"
					/>
				</UFormField>
			</div>

			<!--
				The Event Data half of the same panel: which Event Data this Broadcast
				Graphic points at, and which of its Graphic Inputs read a field of it.
				Offered wherever Graphic Inputs are, because a Graphic Input Binding maps
				one of them to one field and a host with no Graphic Inputs has none to map.
			-->
			<GraphicsCompositorBindings
				:graphics="graphics"
				:selected-target="selectedTarget"
				:game="game"
				:writable="writable"
				@update:graphics="emit('update:graphics', $event)"
			/>
		</template>

		<template v-if="selectedItem">
			<UFormField label="Label" size="sm">
				<UInput
					:model-value="selectedItem.label"
					class="w-full"
					data-testid="graphic-item-label"
					@update:model-value="patchSelectedItem({ label: String($event) })"
				/>
			</UFormField>

			<UFormField label="Visible" size="sm">
				<USwitch
					:model-value="selectedItem.visible"
					data-testid="graphic-item-visible"
					@update:model-value="patchSelectedItem({ visible: $event })"
				/>
			</UFormField>

			<UFormField v-if="isCanvasPositioned" label="Graphic Anchor Point" size="sm">
				<USelect
					:model-value="selectedItem.anchor"
					:items="ANCHOR_OPTIONS"
					value-key="value"
					class="w-full"
					data-testid="graphic-item-anchor"
					@update:model-value="patchSelectedItem({ anchor: $event as GraphicAnchorPoint })"
				/>
			</UFormField>

			<UFormField label="Graphic Geometry Unit" size="sm">
				<USelect
					v-model="geometryUnit"
					:items="GEOMETRY_UNIT_OPTIONS"
					value-key="value"
					class="w-full"
					data-testid="graphic-geometry-unit"
				/>
			</UFormField>

			<div class="grid grid-cols-2 gap-2">
				<UFormField v-if="isCanvasPositioned" label="X" size="sm">
					<UInputNumber
						:model-value="displayedPosition('x')"
						size="sm"
						class="w-full"
						aria-label="Item x"
						@update:model-value="updatePosition('x', $event)"
					/>
				</UFormField>
				<UFormField v-if="isCanvasPositioned" label="Y" size="sm">
					<UInputNumber
						:model-value="displayedPosition('y')"
						size="sm"
						class="w-full"
						aria-label="Item y"
						@update:model-value="updatePosition('y', $event)"
					/>
				</UFormField>
				<UFormField label="Width" size="sm">
					<UInputNumber
						:model-value="displayedSize('width')"
						size="sm"
						class="w-full"
						aria-label="Item width"
						@update:model-value="updateSize('width', $event)"
					/>
				</UFormField>
				<UFormField label="Height" size="sm">
					<UInputNumber
						:model-value="displayedSize('height')"
						size="sm"
						class="w-full"
						aria-label="Item height"
						@update:model-value="updateSize('height', $event)"
					/>
				</UFormField>
			</div>

			<UFormField v-if="isCanvasPositioned" label="Graphic Rotation" size="sm">
				<UInputNumber
					:model-value="selectedItem.rotation ?? 0"
					:min="-360"
					:max="360"
					size="sm"
					class="w-full"
					data-testid="graphic-item-rotation"
					aria-label="Graphic Rotation"
					@update:model-value="patchSelectedItem({ rotation: $event ?? 0 })"
				/>
			</UFormField>
		</template>

		<template v-if="isStackedChild && selectedItem">
			<div class="rounded-lg border border-default/70 p-3">
				<p class="mb-2 text-xs font-semibold text-muted">
					Graphic Group sizing
				</p>
				<UFormField label="Main axis" size="sm">
					<USelect
						:model-value="selectedItem.sizing?.mode ?? 'fixed'"
						:items="SIZING_MODE_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="graphic-group-child-sizing-mode"
						@update:model-value="updateChildSizing({ mode: $event as GraphicGroupChildSizing['mode'] })"
					/>
				</UFormField>
				<UFormField
					v-if="(selectedItem.sizing?.mode ?? 'fixed') === 'fixed'"
					label="Fixed size"
					size="sm"
				>
					<UInputNumber
						:model-value="selectedItem.sizing?.size ?? selectedItem.width"
						:min="0"
						size="sm"
						class="w-full"
						aria-label="Fixed main axis size"
						@update:model-value="updateChildSizing({ size: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField v-else label="Fill weight" size="sm">
					<UInputNumber
						:model-value="selectedItem.sizing?.weight ?? 1"
						:min="0"
						:step="0.5"
						size="sm"
						class="w-full"
						aria-label="Fill weight"
						@update:model-value="updateChildSizing({ weight: $event ?? 1 })"
					/>
				</UFormField>
			</div>
		</template>

		<template v-if="selectedGroup">
			<div class="rounded-lg border border-default/70 p-3 space-y-2">
				<p class="text-xs font-semibold text-muted">
					Graphic Group
				</p>
				<UFormField label="Arrangement" size="sm">
					<USelect
						:model-value="selectedGroup.arrangement"
						:items="ARRANGEMENT_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="graphic-group-arrangement"
						@update:model-value="updateGroup({ arrangement: $event as never })"
					/>
				</UFormField>
				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Padding" size="sm">
						<UInputNumber
							:model-value="selectedGroup.padding"
							:min="0"
							size="sm"
							class="w-full"
							aria-label="Group padding"
							@update:model-value="updateGroup({ padding: $event ?? 0 })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Gap" size="sm">
						<UInputNumber
							:model-value="selectedGroup.gap"
							:min="0"
							size="sm"
							class="w-full"
							aria-label="Group gap"
							@update:model-value="updateGroup({ gap: $event ?? 0 })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Align" size="sm">
						<USelect
							:model-value="selectedGroup.align"
							:items="ALIGN_OPTIONS"
							value-key="value"
							class="w-full"
							@update:model-value="updateGroup({ align: $event as never })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Justify" size="sm">
						<USelect
							:model-value="selectedGroup.justify"
							:items="JUSTIFY_OPTIONS"
							value-key="value"
							class="w-full"
							@update:model-value="updateGroup({ justify: $event as never })"
						/>
					</UFormField>
				</div>
				<UFormField label="Clip children" size="sm">
					<USwitch
						:model-value="selectedGroup.clip"
						data-testid="graphic-group-clip"
						@update:model-value="updateGroup({ clip: $event })"
					/>
				</UFormField>
				<UFormField label="Child style default" size="sm">
					<USwitch
						:model-value="selectedGroup.defaultChildSurfaceStyle !== undefined"
						data-testid="graphic-group-child-style-default"
						@update:model-value="updateDefaultChildStyle($event ? {} : null)"
					/>
				</UFormField>
				<GraphicsCompositorStyleRef
					v-if="selectedGroup.defaultChildSurfaceStyle"
					style-slot="defaultChildSurfaceStyle"
					label="Child style default"
					:entries="styleSet?.entries"
					:current="styleRefFor('defaultChildSurfaceStyle')"
					:writable="canAuthor"
					@bind="entryId => bindStyleRef('defaultChildSurfaceStyle', entryId)"
					@unbind="unbindStyleRef('defaultChildSurfaceStyle')"
				/>
				<UFormField
					v-if="selectedGroup.defaultChildSurfaceStyle"
					label="Child fill opacity"
					size="sm"
				>
					<UInputNumber
						:model-value="selectedGroup.defaultChildSurfaceStyle.fillOpacity"
						:min="0"
						:max="1"
						:step="0.05"
						size="sm"
						class="w-full"
						aria-label="Child fill opacity"
						@update:model-value="updateDefaultChildStyle({ fillOpacity: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField
					v-if="selectedGroup.defaultChildSurfaceStyle?.fill.type === 'solid'"
					label="Child fill"
					size="sm"
				>
					<UIColorPicker
						:model-value="selectedGroup.defaultChildSurfaceStyle.fill.color"
						data-testid="graphic-group-child-fill"
						@update:model-value="updateDefaultChildStyle({ fill: { type: 'solid', color: $event?.toString() || '#000000' } })"
					/>
				</UFormField>
			</div>
		</template>

		<!--
			The Player a Player Life or Game Wins Item reads. Its own control rather
			than part of the shared geometry block, because it is the only property of
			these kinds that decides *whose* live state renders.
		-->
		<UFormField v-if="selectedPlayerSide" label="Player" size="sm">
			<USelect
				:model-value="selectedPlayerSide"
				:items="PLAYER_SIDE_OPTIONS"
				value-key="value"
				class="w-full"
				size="sm"
				data-testid="graphic-item-player-side"
				@update:model-value="updatePlayerSide($event as PlayerSide)"
			/>
		</UFormField>

		<!--
			How a Player Life Item marks a change to the total it renders. The motion
			belongs to the Definition rather than to a Graphic Animation Recipe: it fires
			on a value change from the live session rather than on a lifecycle phase,
			which is not something the shared animation vocabulary expresses.
		-->
		<div v-if="selectedPlayerLife" class="rounded-lg border border-default/70 p-3 space-y-2">
			<p class="text-xs font-semibold text-muted">
				Life change
			</p>
			<UFormField label="Animation" size="sm">
				<USelect
					:model-value="selectedPlayerLife.lifeAnimation"
					:items="PLAYER_LIFE_ANIMATION_OPTIONS"
					value-key="value"
					class="w-full"
					data-testid="player-life-animation"
					@update:model-value="updatePlayerLifeItem({ lifeAnimation: $event as PlayerLifeAnimation })"
				/>
			</UFormField>
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Duration (ms)" size="sm">
					<UInputNumber
						:model-value="selectedPlayerLife.lifeAnimationDurationMs"
						:min="MIN_PLAYER_LIFE_ANIMATION_DURATION_MS"
						:max="MAX_PLAYER_LIFE_ANIMATION_DURATION_MS"
						size="sm"
						class="w-full"
						data-testid="player-life-animation-duration"
						aria-label="Life change duration"
						@update:model-value="updatePlayerLifeItem({ lifeAnimationDurationMs: $event ?? MIN_PLAYER_LIFE_ANIMATION_DURATION_MS })"
					/>
				</UFormField>
				<!-- Tinted by a glow or slide change only; the others ignore it. -->
				<UFormField label="Accent colour" size="sm">
					<UIColorPicker
						:model-value="selectedPlayerLife.lifeAnimationAccentColor"
						data-testid="player-life-animation-accent"
						@update:model-value="updatePlayerLifeItem({ lifeAnimationAccentColor: $event?.toString() || '#ffffff' })"
					/>
				</UFormField>
			</div>
		</div>

		<!--
			A Game Wins Item's own indicator. The box count is deliberately absent: it
			comes from the Match's best-of rather than from configuration, so a layout
			never restates what the session already knows.
		-->
		<div v-if="selectedGameWins" class="rounded-lg border border-default/70 p-3 space-y-2">
			<p class="text-xs font-semibold text-muted">
				Game Wins
			</p>
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Display mode" size="sm">
					<USelect
						:model-value="selectedGameWins.displayMode"
						:items="GAME_WINS_DISPLAY_MODE_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="game-wins-display-mode"
						@update:model-value="updateGameWinsItem({ displayMode: $event as GameWinsDisplayMode })"
					/>
				</UFormField>
				<UFormField v-if="selectedGameWins.displayMode === 'boxes'" label="Box orientation" size="sm">
					<USelect
						:model-value="selectedGameWins.boxOrientation"
						:items="GAME_WINS_BOX_ORIENTATION_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="game-wins-box-orientation"
						@update:model-value="updateGameWinsItem({ boxOrientation: $event as GameWinsBoxOrientation })"
					/>
				</UFormField>
			</div>
			<div v-if="selectedGameWins.displayMode === 'boxes'" class="grid grid-cols-3 gap-2">
				<UFormField label="Box width" size="sm">
					<UInputNumber
						:model-value="selectedGameWins.boxWidth"
						:min="1"
						size="sm"
						class="w-full"
						aria-label="Win box width"
						@update:model-value="updateGameWinsItem({ boxWidth: Math.max(1, $event ?? 1) })"
					/>
				</UFormField>
				<UFormField label="Box height" size="sm">
					<UInputNumber
						:model-value="selectedGameWins.boxHeight"
						:min="1"
						size="sm"
						class="w-full"
						aria-label="Win box height"
						@update:model-value="updateGameWinsItem({ boxHeight: Math.max(1, $event ?? 1) })"
					/>
				</UFormField>
				<UFormField label="Box gap" size="sm">
					<UInputNumber
						:model-value="selectedGameWins.boxGap"
						:min="0"
						size="sm"
						class="w-full"
						aria-label="Win box gap"
						@update:model-value="updateGameWinsItem({ boxGap: $event ?? 0 })"
					/>
				</UFormField>
			</div>
		</div>

		<template v-if="selectedTextItem">
			<UFormField label="Text" size="sm">
				<UTextarea
					:model-value="selectedTextItem.text"
					:rows="3"
					:maxlength="MAX_GRAPHIC_TEXT_LENGTH"
					class="w-full"
					data-testid="graphic-item-text"
					@update:model-value="updateTextItem({ text: String($event) })"
				/>
			</UFormField>

			<!--
				The host's token binding catalogue, offered to reference rather than to
				author. A Feature Match Overlay's placeholder vocabulary is fixed, so the
				useful control is one that appends a valid key to the template — the
				editor offers exactly these keys, and an author never declares one.
			-->
			<UFormField v-if="hostTokens.length > 0" label="Tokens" size="sm">
				<div class="flex flex-wrap gap-1" data-testid="graphic-host-tokens">
					<UButton
						v-for="token in hostTokens"
						:key="token.key"
						size="xs"
						variant="soft"
						color="neutral"
						:disabled="!canAuthor"
						:title="token.label"
						:data-host-token="token.key"
						@click="appendHostToken(token.key)"
					>
						{{ placeholderToken(token.key) }}
					</UButton>
				</div>
			</UFormField>
		</template>

		<!--
			Base typography, offered wherever the selection paints text. A Clock, a
			Player Life, and a Game Wins Item rendering its win count read their string
			from the live Feature Match Session rather than from an author — which
			decides what the item says, and nothing about how it is set.
		-->
		<template v-if="selectedTypography">
			<GraphicsCompositorStyleRef
				style-slot="typography"
				label="Typography"
				:entries="styleSet?.entries"
				:current="styleRefFor('typography')"
				:writable="canAuthor"
				@bind="entryId => bindStyleRef('typography', entryId)"
				@unbind="unbindStyleRef('typography')"
			/>

			<!--
				A font is either one that ships with Stream Keepr or one exact font
				Graphic Asset Revision from the Graphics Asset Library. The library arm
				pins a revision exactly as a Media Graphic Item does, which is what puts
				it in this Screen's reference index and so inside its Screen Output Asset
				Capability.
			-->
			<UFormField label="Font source" size="sm">
				<USelect
					:model-value="fontSource"
					:items="FONT_SOURCE_OPTIONS"
					value-key="value"
					class="w-full"
					data-testid="typography-font-source"
					@update:model-value="updateFontSource($event as 'application' | 'asset')"
				/>
			</UFormField>

			<UFormField v-if="fontSource === 'application'" label="Font" size="sm">
				<USelect
					:model-value="selectedFont?.kind === 'application' ? selectedFont.fontId : undefined"
					:items="GRAPHIC_FONT_OPTIONS"
					value-key="value"
					class="w-full"
					@update:model-value="updateTypography({ font: applicationGraphicFont($event as never) })"
				/>
			</UFormField>

			<UFormField v-else label="Library font" size="sm">
				<GraphicsAssetFocusPicker
					:model-value="selectedFontAsset"
					:event-id="eventId"
					field-label="Typography"
					asset-kind="font"
					@update:model-value="$event ? undefined : clearFontAsset()"
					@select="selectFontAsset"
				/>
			</UFormField>

			<div class="grid grid-cols-2 gap-2">
				<UFormField label="Size" size="sm">
					<UInputNumber
						:model-value="selectedTypography.fontSize"
						:min="1"
						size="sm"
						class="w-full"
						aria-label="Font size"
						@update:model-value="updateTypography({ fontSize: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField label="Weight" size="sm">
					<UInputNumber
						:model-value="selectedTypography.fontWeight"
						:min="1"
						:max="1000"
						size="sm"
						class="w-full"
						aria-label="Font weight"
						@update:model-value="updateTypography({ fontWeight: $event ?? 400 })"
					/>
				</UFormField>
				<UFormField label="Letter spacing" size="sm">
					<UInputNumber
						:model-value="selectedTypography.letterSpacing"
						size="sm"
						class="w-full"
						aria-label="Letter spacing"
						@update:model-value="updateTypography({ letterSpacing: $event ?? 0 })"
					/>
				</UFormField>
				<UFormField label="Line height" size="sm">
					<UInputNumber
						:model-value="selectedTypography.lineHeight"
						:step="0.05"
						size="sm"
						class="w-full"
						aria-label="Line height"
						@update:model-value="updateTypography({ lineHeight: $event ?? 1 })"
					/>
				</UFormField>
				<UFormField label="Style" size="sm">
					<USelect
						:model-value="selectedTypography.fontStyle"
						:items="FONT_STYLE_OPTIONS"
						value-key="value"
						class="w-full"
						@update:model-value="updateTypography({ fontStyle: $event as never })"
					/>
				</UFormField>
				<UFormField label="Case" size="sm">
					<USelect
						:model-value="selectedTypography.textTransform"
						:items="TEXT_TRANSFORM_OPTIONS"
						value-key="value"
						class="w-full"
						@update:model-value="updateTypography({ textTransform: $event as never })"
					/>
				</UFormField>
				<UFormField label="Align" size="sm">
					<USelect
						:model-value="selectedTypography.textAlign"
						:items="TEXT_ALIGN_OPTIONS"
						value-key="value"
						class="w-full"
						@update:model-value="updateTypography({ textAlign: $event as never })"
					/>
				</UFormField>
				<UFormField label="Colour" size="sm">
					<UIColorPicker
						:model-value="selectedTypography.color"
						@update:model-value="updateTypography({ color: $event?.toString() || '#ffffff' })"
					/>
				</UFormField>
			</div>
		</template>

		<!--
			Text does not render with visible overflow beyond its authored bounds, and a
			string from a live Feature Match Session can be longer than the author ever
			saw — so a Clock and a Player Life are bounded by the same policy a Text
			Graphic Item is.
		-->
		<template v-if="selectedTextOverflow">
			<UFormField label="Text Overflow Policy" size="sm">
				<USelect
					:model-value="selectedTextOverflow.overflowPolicy"
					:items="OVERFLOW_POLICY_OPTIONS"
					value-key="value"
					class="w-full"
					data-testid="text-overflow-policy"
					@update:model-value="updateTextOverflow({ overflowPolicy: $event })"
				/>
			</UFormField>

			<UFormField
				v-if="selectedTextOverflow.overflowPolicy === 'shrink'"
				label="Minimum font size"
				size="sm"
			>
				<UInputNumber
					:model-value="selectedTextOverflow.minFontSize"
					:min="1"
					size="sm"
					class="w-full"
					data-testid="text-min-font-size"
					aria-label="Minimum font size"
					@update:model-value="updateTextOverflow({ minFontSize: $event ?? 1 })"
				/>
			</UFormField>
		</template>

		<template v-if="selectedTextItem">
			<!--
				One optional typography override per `{inputKey}` this Graphic Text Template
				names. Literal text always uses the base typography above, and only
				placeholders naming a declared Graphic Input can be styled — styling one
				that nothing declares would style something that renders nothing.
			-->
			<div
				v-for="inputKey in styleablePlaceholders"
				:key="inputKey"
				class="space-y-2 rounded-lg border border-default/70 p-2"
				:data-graphic-placeholder-style="inputKey"
			>
				<div class="flex items-center gap-2">
					<span class="min-w-0 flex-1 truncate font-mono text-xs">{{ placeholderToken(inputKey) }}</span>
					<UButton
						size="xs"
						variant="ghost"
						color="neutral"
						data-testid="graphic-placeholder-style-clear"
						@click="updatePlaceholderStyle(inputKey, null)"
					>
						Use base
					</UButton>
				</div>
				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Size" size="xs">
						<UInputNumber
							:model-value="placeholderStyleFor(inputKey).fontSize"
							:min="1"
							size="sm"
							class="w-full"
							data-testid="graphic-placeholder-style-size"
							@update:model-value="updatePlaceholderStyle(inputKey, { fontSize: $event ?? undefined })"
						/>
					</UFormField>
					<UFormField label="Weight" size="xs">
						<UInputNumber
							:model-value="placeholderStyleFor(inputKey).fontWeight"
							:min="100"
							:max="900"
							:step="100"
							size="sm"
							class="w-full"
							data-testid="graphic-placeholder-style-weight"
							@update:model-value="updatePlaceholderStyle(inputKey, { fontWeight: $event ?? undefined })"
						/>
					</UFormField>
					<UFormField label="Colour" size="xs" class="col-span-2">
						<UIColorPicker
							:model-value="placeholderStyleFor(inputKey).color ?? selectedTextItem.typography.color"
							data-testid="graphic-placeholder-style-color"
							@update:model-value="updatePlaceholderStyle(inputKey, { color: $event?.toString() || undefined })"
						/>
					</UFormField>
				</div>
			</div>
		</template>

		<template v-if="selectedMediaItem">
			<div class="rounded-lg border border-default/70 p-3 space-y-2">
				<p class="text-xs font-semibold text-muted">
					Media
				</p>

				<GraphicsCompositorStyleRef
					style-slot="media"
					label="Media treatment"
					:entries="styleSet?.entries"
					:current="styleRefFor('media')"
					:writable="canAuthor"
					@bind="entryId => bindStyleRef('media', entryId)"
					@unbind="unbindStyleRef('media')"
				/>

				<!--
					The picker pins one exact Graphic Asset identity and revision, and
					reports a Missing Graphic Asset Reference or Unavailable Graphic Asset
					Content against this exact item so an author repairs the item that
					pinned it. A Broadcast Graphics Screen Output is consumed as a
					Chromium browser source, which is what makes VP9 alpha selectable.
				-->
				<UFormField label="Graphic Asset" size="sm">
					<GraphicsAssetFocusPicker
						:model-value="selectedMediaItem.asset"
						:event-id="eventId"
						field-label="Media Graphic Item"
						:asset-kind="['image', 'silent-video']"
						video-target="chromium"
						@update:model-value="$event ? undefined : clearMediaAsset()"
						@select="selectMediaAsset"
					/>
				</UFormField>

				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Fit" size="sm">
						<USelect
							:model-value="selectedMediaItem.fit"
							:items="MEDIA_FIT_OPTIONS"
							value-key="value"
							class="w-full"
							data-testid="media-fit"
							@update:model-value="updateMediaItem({ fit: $event as MediaGraphicItemFit })"
						/>
					</UFormField>
					<UFormField label="Opacity" size="sm">
						<UInputNumber
							:model-value="selectedMediaItem.opacity"
							:min="0"
							:max="1"
							:step="0.05"
							size="sm"
							class="w-full"
							data-testid="media-opacity"
							aria-label="Media opacity"
							@update:model-value="updateMediaItem({ opacity: $event ?? 1 })"
						/>
					</UFormField>
					<UFormField label="Focal X" size="sm">
						<UInputNumber
							:model-value="selectedMediaItem.focalPosition.horizontal"
							:min="0"
							:max="1"
							:step="0.05"
							size="sm"
							class="w-full"
							data-testid="media-focal-horizontal"
							aria-label="Horizontal focal position"
							@update:model-value="updateFocalPosition({ horizontal: $event ?? 0.5 })"
						/>
					</UFormField>
					<UFormField label="Focal Y" size="sm">
						<UInputNumber
							:model-value="selectedMediaItem.focalPosition.vertical"
							:min="0"
							:max="1"
							:step="0.05"
							size="sm"
							class="w-full"
							data-testid="media-focal-vertical"
							aria-label="Vertical focal position"
							@update:model-value="updateFocalPosition({ vertical: $event ?? 0.5 })"
						/>
					</UFormField>
				</div>

				<!--
					Playback belongs to a silent video, so an image item is offered
					neither control even though it stores both — switching an item back to
					a video restores the playback its author already set up.
				-->
				<template v-if="selectedMediaItem.mediaKind === 'silent-video'">
					<UFormField label="Playback rate" size="sm">
						<UInputNumber
							:model-value="selectedMediaItem.playbackRate"
							:min="MIN_GRAPHIC_MEDIA_PLAYBACK_RATE"
							:max="MAX_GRAPHIC_MEDIA_PLAYBACK_RATE"
							:step="0.05"
							size="sm"
							class="w-full"
							data-testid="media-playback-rate"
							aria-label="Playback rate"
							@update:model-value="updateMediaItem({ playbackRate: $event ?? 1 })"
						/>
					</UFormField>
					<UFormField label="Loop" size="sm">
						<USwitch
							:model-value="selectedMediaItem.loop"
							data-testid="media-loop"
							@update:model-value="updateMediaItem({ loop: $event })"
						/>
					</UFormField>
					<p class="text-xs text-muted">
						Video is silent, and starts from its beginning when its Broadcast Graphic enters.
					</p>
				</template>

				<UFormField label="Clip to Shape Geometry" size="sm">
					<USwitch
						:model-value="selectedMediaItem.clipGeometry !== undefined"
						data-testid="media-clip-enabled"
						@update:model-value="updateMediaClipping($event)"
					/>
				</UFormField>
			</div>
		</template>

		<template v-if="selectedGeometry">
			<div class="rounded-lg border border-default/70 p-3 space-y-2">
				<p class="text-xs font-semibold text-muted">
					{{ geometryTitle }}
				</p>

				<GraphicsCompositorStyleRef
					:style-slot="geometryStyleSlot"
					label="Shape Geometry"
					:entries="styleSet?.entries"
					:current="styleRefFor(geometryStyleSlot)"
					:writable="canAuthor"
					@bind="entryId => bindStyleRef(geometryStyleSlot, entryId)"
					@unbind="unbindStyleRef(geometryStyleSlot)"
				/>
				<UFormField label="Preset" size="sm">
					<USelect
						:items="GEOMETRY_PRESET_OPTIONS"
						value-key="value"
						placeholder="Apply preset..."
						class="w-full"
						data-testid="shape-geometry-preset"
						@update:model-value="applyPreset($event as ShapeGeometryPresetId)"
					/>
				</UFormField>

				<div v-for="corner in SHAPE_CORNER_KEYS" :key="corner" class="grid grid-cols-2 gap-2">
					<UFormField :label="CORNER_LABELS[corner]" size="sm">
						<USelect
							:model-value="selectedGeometry[corner].treatment"
							:items="CORNER_TREATMENT_OPTIONS"
							value-key="value"
							class="w-full"
							:data-testid="`shape-corner-${corner}`"
							@update:model-value="updateCorner(corner, { treatment: $event as never })"
						/>
					</UFormField>
					<UFormField
						v-if="selectedGeometry[corner].treatment !== 'square'"
						label="Size"
						size="sm"
					>
						<UInputNumber
							:model-value="selectedGeometry[corner].size"
							:min="0"
							size="sm"
							class="w-full"
							:aria-label="`${CORNER_LABELS[corner]} size`"
							@update:model-value="updateCorner(corner, { size: $event ?? 0 })"
						/>
					</UFormField>
				</div>

				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Left slant" size="sm">
						<UInputNumber
							:model-value="selectedGeometry.leftSlant"
							size="sm"
							class="w-full"
							data-testid="shape-left-slant"
							aria-label="Left edge slant"
							@update:model-value="updateGeometry({ leftSlant: $event ?? 0 })"
						/>
					</UFormField>
					<UFormField label="Right slant" size="sm">
						<UInputNumber
							:model-value="selectedGeometry.rightSlant"
							size="sm"
							class="w-full"
							data-testid="shape-right-slant"
							aria-label="Right edge slant"
							@update:model-value="updateGeometry({ rightSlant: $event ?? 0 })"
						/>
					</UFormField>
				</div>
			</div>
		</template>

		<!--
			A Media Graphic Item paints an asset rather than a surface, so it is offered
			none. Every other kind gets the same controls, and a Game Wins Item gets
			them three times over — its own surface, and the two that paint a win box
			before and after the Player wins it.
		-->
		<GraphicsCompositorSurfaceStyleFields
			v-if="selectedItem && selectedItem.type !== 'media'"
			:surface-style="ownSurfaceStyle"
			title="Graphic Surface Style"
			:presence-label="parentGroup ? 'Override group style default' : 'Paint a surface'"
			@edit="applySurfaceStyleEdit('surfaceStyle', $event)"
		>
			<template #style-ref>
				<!--
					Two references, because a surface preset may itself carry a Graphic Fill
					preset and an author may want the brand surface with this one gradient.
					The finer of the two is applied last and wins.
				-->
				<GraphicsCompositorStyleRef
					style-slot="surfaceStyle"
					label="Surface style"
					:entries="styleSet?.entries"
					:current="styleRefFor('surfaceStyle')"
					:writable="canAuthor"
					@bind="entryId => bindStyleRef('surfaceStyle', entryId)"
					@unbind="unbindStyleRef('surfaceStyle')"
				/>
				<GraphicsCompositorStyleRef
					style-slot="surfaceStyle.fill"
					label="Graphic Fill"
					:entries="styleSet?.entries"
					:current="styleRefFor('surfaceStyle.fill')"
					:writable="canAuthor"
					@bind="entryId => bindStyleRef('surfaceStyle.fill', entryId)"
					@unbind="unbindStyleRef('surfaceStyle.fill')"
				/>
			</template>
		</GraphicsCompositorSurfaceStyleFields>

		<template v-if="selectedGameWins && selectedGameWins.displayMode === 'boxes'">
			<GraphicsCompositorSurfaceStyleFields
				:surface-style="selectedGameWins.boxSurfaceStyle"
				title="Win box"
				test-id-prefix="game-wins-box"
				@edit="applySurfaceStyleEdit('boxSurfaceStyle', $event)"
			>
				<template #style-ref>
					<GraphicsCompositorStyleRef
						style-slot="boxSurfaceStyle"
						label="Win box style"
						:entries="styleSet?.entries"
						:current="styleRefFor('boxSurfaceStyle')"
						:writable="canAuthor"
						@bind="entryId => bindStyleRef('boxSurfaceStyle', entryId)"
						@unbind="unbindStyleRef('boxSurfaceStyle')"
					/>
				</template>
			</GraphicsCompositorSurfaceStyleFields>
			<GraphicsCompositorSurfaceStyleFields
				:surface-style="selectedGameWins.wonBoxSurfaceStyle"
				title="Won win box"
				test-id-prefix="game-wins-won-box"
				@edit="applySurfaceStyleEdit('wonBoxSurfaceStyle', $event)"
			>
				<template #style-ref>
					<GraphicsCompositorStyleRef
						style-slot="wonBoxSurfaceStyle"
						label="Won win box style"
						:entries="styleSet?.entries"
						:current="styleRefFor('wonBoxSurfaceStyle')"
						:writable="canAuthor"
						@bind="entryId => bindStyleRef('wonBoxSurfaceStyle', entryId)"
						@unbind="unbindStyleRef('wonBoxSurfaceStyle')"
					/>
				</template>
			</GraphicsCompositorSurfaceStyleFields>
		</template>

		<GraphicsCompositorAnimation
			:graphics="graphics"
			:selected-target="selectedTarget"
			:writable="writable"
			:style-set="styleSet"
			@update:graphics="emit('update:graphics', $event)"
		/>
	</fieldset>
</template>
