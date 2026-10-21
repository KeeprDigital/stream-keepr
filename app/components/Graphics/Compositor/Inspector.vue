<script setup lang="ts">
import type {
	GraphicsHostContract,
} from '~~/shared/modules/graphics';
import type { SupportedSocialNetwork } from '~~/shared/socialProfiles';
import type { Game, PlayerSide } from '~~/shared/types/enums';
import type {
	BroadcastGraphicConfig,
	DeckListGraphicItemConfig,
	DeckListView,
	GameWinsBoxOrientation,
	GameWinsDisplayMode,
	GameWinsGraphicItemConfig,
	GraphicFontSelection,
	GraphicFontSource,
	GraphicGroupChildSizing,
	GraphicGroupItemConfig,
	GraphicInputDeclaration,
	GraphicInputType,
	GraphicMediaKind,
	GraphicPlaceholderStyle,
	GraphicSurfaceStyle,
	GraphicTypography,
	MediaGraphicItemConfig,
	OnAirUpdatePolicy,
	PlayerLifeAnimation,
	PlayerLifeGraphicItemConfig,
	ShapeGeometry,
	SocialNetworkIconGraphicItemConfig,
	TEXT_OVERFLOW_POLICY_VALUES,
	TextGraphicItemConfig,
} from '~~/shared/types/graphics';
import type { GraphicAsset, GraphicAssetReference } from '~~/shared/types/graphicsAsset';
import type { GraphicStyleRef, GraphicStyleSlot } from '~~/shared/types/graphicStyleSet';
import type { GraphicStyleAuthoringContext } from '~/composables/screen/useGraphicStyleSetAuthoring';
import type { GraphicsSelectionTarget } from '~/modules/graphics/selection';
import type { MediaFieldsPatch } from '~/utils/mediaFields';
import {
	addGraphicInput,
	applyGraphicSurfaceStyleEdit,
	applyShapeGeometryPreset,
	authorsGraphicInputs,
	clearMediaGraphicItemAsset,
	DEFAULT_GRAPHIC_FONT_ID,
	deleteGraphicInput,
	graphicItemIcon,
	graphicItemKindLabel,
	graphicItemSummary,
	graphicsHostTokenCatalogue,
	graphicTextTemplateDottedPlaceholderKeys,
	graphicTextTemplateInputKeys,
	patchBroadcastGraphic,
	patchDeckListGraphicItem,
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
	patchShapeGeometry,
	patchTextGraphicItem,
	selectMediaGraphicItemAsset,
	setGraphicInputChoiceOptions,
	setGraphicInputMediaKind,
	setMediaClipGeometry,
} from '~~/shared/modules/graphics';
import { SUPPORTED_SOCIAL_NETWORKS } from '~~/shared/socialProfiles';
import {
	applicationGraphicFont,
	DECK_LIST_VIEW_VALUES,
	GAME_WINS_BOX_ORIENTATION_VALUES,
	GAME_WINS_DISPLAY_MODE_VALUES,
	GRAPHIC_GROUP_ALIGN_VALUES,
	GRAPHIC_GROUP_ARRANGEMENT_VALUES,
	GRAPHIC_GROUP_JUSTIFY_VALUES,
	GRAPHIC_INPUT_TYPE_VALUES,
	GRAPHIC_TEXT_ALIGN_VALUES,
	MAX_GRAPHIC_FONT_SIZE,
	MAX_GRAPHIC_INPUT_CHOICE_OPTIONS,
	MAX_GRAPHIC_INPUT_LABEL_LENGTH,
	MAX_GRAPHIC_TEXT_LENGTH,
	MAX_PLAYER_LIFE_ANIMATION_DURATION_MS,
	MIN_GRAPHIC_FONT_SIZE,
	MIN_PLAYER_LIFE_ANIMATION_DURATION_MS,
	PLAYER_LIFE_ANIMATION_VALUES,
	SOCIAL_PROFILE_PROJECTED_TEXT_VALUE_VALUES,
} from '~~/shared/types/graphics';
import { useCompositorEditing } from '~/modules/graphics/compositorEditing';
import { resolveGraphicsSelection } from '~/modules/graphics/selection';
import { resolveMediaFieldsPatch } from '~/utils/mediaFields';
import GraphicsGeometryFields from '../GeometryFields.vue';
import GraphicsShapeGeometryFields from '../ShapeGeometryFields.vue';
import GraphicsCompositorAnimation from './Animation.vue';
import GraphicsCompositorBindings from './Bindings.vue';
import GraphicsCompositorSocialProfileProjections from './SocialProfileProjections.vue';

/**
 * Property controls for the current selection: the Broadcast Graphic, or one
 * Graphic Item's geometry, Graphic Anchor Point, Graphic Surface Style, and
 * kind-specific properties. Geometry is authored in any Geometry Unit and
 * always stored as canonical canvas pixels.
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
 * Every edit here goes through the compositor editing module. It checks the Graphics
 * Authoring Lease (fail closed: a caller that does not grant authoring gets a
 * read-only editor), resolves the selection, applies the authoring operation,
 * re-captures Graphic Style Set overrides, and replaces the stack. The controls below
 * write values and hand it the authoring operation that writes them.
 */
const { canAuthor, editItem, editGraphic, bindStyleRef, unbindStyleRef } = useCompositorEditing(
	() => ({
		graphics: props.graphics,
		selectedTarget: props.selectedTarget,
		writable: props.writable,
		styleSet: props.styleSet,
	}),
	graphics => emit('update:graphics', graphics),
);

const OVERFLOW_POLICY_OPTIONS = [
	{ label: 'Clip', value: 'clip' },
	{ label: 'Ellipsis', value: 'ellipsis' },
	{ label: 'Shrink then ellipsis', value: 'shrink' },
] satisfies Array<{ label: string; value: typeof TEXT_OVERFLOW_POLICY_VALUES[number] }>;
const TEXT_ALIGN_OPTIONS = GRAPHIC_TEXT_ALIGN_VALUES.map(value => ({ label: value, value }));
const PLAYER_LIFE_ANIMATION_OPTIONS = PLAYER_LIFE_ANIMATION_VALUES.map(value => ({ label: value, value }));
const GAME_WINS_DISPLAY_MODE_OPTIONS = GAME_WINS_DISPLAY_MODE_VALUES.map(value => ({ label: value, value }));
const GAME_WINS_BOX_ORIENTATION_OPTIONS = GAME_WINS_BOX_ORIENTATION_VALUES.map(value => ({ label: value, value }));
const DECK_LIST_VIEW_OPTIONS = DECK_LIST_VIEW_VALUES.map(value => ({ label: value, value }));
const SOCIAL_NETWORK_OPTIONS = SUPPORTED_SOCIAL_NETWORKS.map(network => ({
	label: network.label,
	value: network.key,
}));
const SOCIAL_NETWORK_ICON_SOURCE_OPTIONS = [
	{ label: 'Static network', value: 'static' },
	{ label: 'Social Profile Projection', value: 'projection' },
];
const ARRANGEMENT_OPTIONS = GRAPHIC_GROUP_ARRANGEMENT_VALUES.map(value => ({ label: value, value }));
const ALIGN_OPTIONS = GRAPHIC_GROUP_ALIGN_VALUES.map(value => ({ label: value, value }));
const JUSTIFY_OPTIONS = GRAPHIC_GROUP_JUSTIFY_VALUES.map(value => ({ label: value, value }));
const SIZING_MODE_OPTIONS = [
	{ label: 'Fixed', value: 'fixed' },
	{ label: 'Weighted fill', value: 'fill' },
] satisfies Array<{ label: string; value: GraphicGroupChildSizing['mode'] }>;

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
const selectedSocialNetworkIcon = computed<SocialNetworkIconGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'social-network-icon' ? selectedItem.value : null,
);
const socialProfileProjectionOptions = computed(() => {
	const current = selection.value;
	if (current.kind !== 'item' || !current.group)
		return [];
	return (current.graphic.socialProfileProjections ?? [])
		.filter(projection => projection.presentationGroupId === current.group?.id)
		.map(projection => ({ label: projection.label, value: projection.key }));
});
const invalidSocialNetworkIconProjection = computed(() => {
	const icon = selectedSocialNetworkIcon.value;
	const network = icon?.network;
	if (!network || typeof network === 'string')
		return false;
	return !socialProfileProjectionOptions.value.some(option => option.value === network.projectionKey);
});

function updateSocialNetworkIconSource(source: 'static' | 'projection') {
	if (source === 'static') {
		editItem(patchGraphicItem, { network: 'twitch' });
		return;
	}
	const projectionKey = socialProfileProjectionOptions.value[0]?.value;
	if (projectionKey)
		editItem(patchGraphicItem, { network: { projectionKey } });
}
const selectedGroup = computed<GraphicGroupItemConfig | null>(() =>
	selectedItem.value?.type === 'group' ? selectedItem.value : null,
);
const selectedPlayerLife = computed<PlayerLifeGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'player-life' ? selectedItem.value : null,
);
const selectedGameWins = computed<GameWinsGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'game-wins' ? selectedItem.value : null,
);
const selectedDeckList = computed<DeckListGraphicItemConfig | null>(() =>
	selectedItem.value?.type === 'deck-list' ? selectedItem.value : null,
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
	if (
		!item
		|| item.type === 'shape'
		|| item.type === 'media'
		|| item.type === 'social-network-icon'
		|| item.type === 'group'
	) {
		return null;
	}
	if (item.type === 'game-wins')
		return item.displayMode === 'number' ? item.typography : null;
	// A Deck List Item paints text only in its list view; the grid renders cards.
	if (item.type === 'deck-list')
		return item.view === 'list' ? item.typography : null;
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
	return item?.type === 'player-life' || item?.type === 'game-wins' || item?.type === 'deck-list'
		? item.playerSide
		: null;
});

const PLAYER_SIDE_OPTIONS = [
	{ label: 'Player 1', value: 'player1' },
	{ label: 'Player 2', value: 'player2' },
] satisfies Array<{ label: string; value: PlayerSide }>;

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
 * that paint a surface, and it paints an asset. A Deck List Item renders cards
 * only, so it has none either.
 */
const ownSurfaceStyle = computed<GraphicSurfaceStyle | null>(() => {
	const item = selectedItem.value;
	if (!item || item.type === 'media' || item.type === 'social-network-icon' || item.type === 'deck-list')
		return null;
	return item.surfaceStyle ?? null;
});

/** A Geometry Unit projects against the containing canvas — a Graphic Group for its children. */
const geometryContainer = computed(() => parentGroup.value
	? { width: parentGroup.value.width, height: parentGroup.value.height }
	: { width: props.canvasWidth, height: props.canvasHeight });

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
const fontSourceOverride = ref<GraphicFontSelection['kind']>();
const selectedFont = computed(() => selectedTypography.value?.font);
const fontSource = computed<GraphicFontSource>(() =>
	fontSourceOverride.value ?? selectedFont.value?.kind ?? 'application');

watch(selection, () => {
	fontSourceOverride.value = undefined;
});

/**
 * The arm the base typography's font control moved to.
 *
 * It takes the control's whole union rather than the two arms this panel renders, so
 * "same as base" has to be named here rather than cast away. A `GraphicTypography`
 * must name a font, so the answer is not offered (`optional` is absent below) and is
 * refused if it ever arrives — reaching either branch with it would leave the panel
 * showing no font control at all. Letting the compiler ask the question is the point:
 * a cast made this the one invariant of the shared control nothing checked (#199).
 */
function updateFontSource(source: GraphicFontSource) {
	if (source === 'base')
		return;
	fontSourceOverride.value = source;
	if (source === 'application' && selectedFont.value?.kind === 'asset')
		editItem(patchGraphicTypography, { font: applicationGraphicFont(DEFAULT_GRAPHIC_FONT_ID) });
}

/** Pin one exact font Graphic Asset Revision, as a Media Graphic Item pins content. */
function selectFontAsset(_asset: GraphicAsset, reference: GraphicAssetReference) {
	editItem(patchGraphicTypography, { font: { kind: 'asset', reference } });
}

/** Unpinning a library font leaves the item on an application font rather than none. */
function clearFontAsset() {
	editItem(patchGraphicTypography, { font: applicationGraphicFont(DEFAULT_GRAPHIC_FONT_ID) });
}

/** A cleared opacity is opaque again and a cleared playback rate is normal speed. */
function updateMediaFields(patch: MediaFieldsPatch) {
	const { focalPosition, ...rest } = resolveMediaFieldsPatch(patch);
	if (focalPosition)
		editItem(patchMediaFocalPosition, focalPosition);
	else
		editItem(patchMediaGraphicItem, rest);
}

/**
 * Pin one exact Graphic Asset identity and revision. The asset's own kind decides
 * the item's media kind.
 */
function selectMediaAsset(asset: GraphicAsset, reference: GraphicAssetReference) {
	editItem(selectMediaGraphicItemAsset, {
		asset: reference,
		mediaKind: asset.kind === 'silent-video' ? 'silent-video' : 'image',
	});
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
 * Every placeholder the selected Graphic Item's template may name, whichever side
 * supplies it. One list rather than two branches at each use, because the question
 * a placeholder asks — "does anything resolve this key?" — has one answer however
 * the host answers it.
 *
 * Carries the label as well as the key, because the whole difficulty an author has
 * here is that the two are not the same word: an input named 'leftName' is keyed
 * `input-1`, and a template naming the name resolves nothing (#234).
 */
const availablePlaceholders = computed<Array<{ key: string; label: string }>>(() => {
	if (!authorsInputs.value)
		return hostTokens.value.map(token => ({ key: token.key, label: token.label }));

	const current = selection.value;
	if (current.kind !== 'graphic' && current.kind !== 'item')
		return [];
	const inputs = (current.graphic.inputs ?? []).map(input => ({ key: input.key, label: input.label }));
	const valueLabels = {
		networkLabel: 'Projected network label',
		handle: 'Projected handle',
		profileUrl: 'Projected profile URL',
	} as const;
	const projections = current.kind === 'item'
		? (current.graphic.socialProfileProjections ?? []).filter(projection =>
				projection.presentationGroupId === current.group?.id,
			)
		: current.graphic.socialProfileProjections ?? [];
	const projected = projections.flatMap(projection =>
		SOCIAL_PROFILE_PROJECTED_TEXT_VALUE_VALUES.map(value => ({
			key: `${projection.key}.${value}`,
			label: `${valueLabels[value]} — ${projection.label}`,
		})),
	);
	return [...inputs, ...projected];
});

const availablePlaceholderKeys = computed(() => availablePlaceholders.value.map(entry => entry.key));

/**
 * The `{inputKey}` placeholders of the selected Text Graphic Item that nothing
 * resolves.
 *
 * These render as nothing at all — deliberately, since a Text Graphic Item must
 * keep painting the literal text around a value it cannot show — which leaves an
 * author who typed the input's *name* instead of its key with a template that
 * looks finished and shows a gap. Naming them here is the only place that
 * difference is visible before air.
 */
const unresolvedPlaceholders = computed<string[]>(() => {
	const item = selectedTextItem.value;
	if (!item)
		return [];

	const available = new Set(availablePlaceholderKeys.value);
	return [
		...graphicTextTemplateInputKeys(item.text),
		...graphicTextTemplateDottedPlaceholderKeys(item.text),
	].filter(key => !available.has(key));
});

const INPUT_TYPE_OPTIONS = GRAPHIC_INPUT_TYPE_VALUES.map(value => ({ label: value, value }));
const UPDATE_POLICY_OPTIONS = [
	{ label: 'Staged', value: 'staged' },
	{ label: 'Live', value: 'live' },
] satisfies Array<{ label: string; value: OnAirUpdatePolicy }>;
const MEDIA_KIND_OPTIONS = [
	{ label: 'Image', value: 'image' },
	{ label: 'Silent video', value: 'silent-video' },
] satisfies Array<{ label: string; value: GraphicMediaKind }>;

/**
 * What a choice Graphic Input with no default is offered as.
 *
 * Outside the option space rather than beside it: an option's stored value is at
 * least one character everywhere it is written, so nothing an author can declare
 * collides with it.
 */
const NO_CHOICE_DEFAULT = '';

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
	if (!item)
		return;

	const next = `${item.text}${placeholderToken(key)}`;
	if (next.length <= MAX_GRAPHIC_TEXT_LENGTH)
		editItem(patchTextGraphicItem, { text: next });
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
	editGraphic(patchGraphicInput, key, patch);
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

	editGraphic(setGraphicInputChoiceOptions, key, options.slice(0, MAX_GRAPHIC_INPUT_CHOICE_OPTIONS));
}

/**
 * What a choice Graphic Input's Default may be set to: one of its own options, or
 * nothing.
 *
 * Offering the declared options rather than a free field is what keeps the default
 * inside them — a default outside its options is a value the input reports
 * unavailable, so a placed Broadcast Graphic would start on something it can never
 * show. The other half of the same rule lives on the write path, which drops a
 * default an edited option list stops offering.
 */
function choiceDefaultOptions(input: GraphicInputDeclaration) {
	return [
		{ label: 'No default', value: NO_CHOICE_DEFAULT },
		...(input.type === 'choice' ? input.options : []).map(option => ({
			label: option.label,
			value: option.value,
		})),
	];
}

function updateChoiceDefault(key: string, value: string) {
	updateInput(key, { default: value === NO_CHOICE_DEFAULT ? null : value });
}

/**
 * Pin one exact Graphic Asset Revision as a media Graphic Input's default. The
 * authored default is indexed from the configuration the same way an item's asset is.
 */
function selectInputDefaultAsset(key: string, reference: GraphicAssetReference) {
	updateInput(key, { default: { ...reference } });
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
	return [
		...graphicTextTemplateInputKeys(current.item.text),
		...graphicTextTemplateDottedPlaceholderKeys(current.item.text),
	].filter(key => available.has(key));
});

function placeholderStyleFor(inputKey: string): GraphicPlaceholderStyle {
	return selectedTextItem.value?.placeholderStyles?.[inputKey] ?? {};
}

/**
 * Which arm each placeholder's author is editing, when its stored style cannot say.
 *
 * The same override as the base typography control above, kept per `{inputKey}`
 * because the panel offers one of these per placeholder. It holds the one state the
 * stored value cannot express — "Library font" chosen with no revision pinned yet —
 * and writing the asset arm at that moment would store a font that is nothing, which
 * is what `graphicFontSelectionSchema` refuses on the way in. Cleared whenever the
 * selection moves, so a control never describes the previous item's placeholders.
 *
 * Unlike the base typography's, this one honours all three of `GraphicFontSource`'s
 * answers: a placeholder's font is optional, so "same as base" is a real answer here
 * rather than the absence of one, and it is what every placeholder starts on.
 */
const placeholderFontSourceOverrides = ref<Record<string, GraphicFontSource>>({});

watch(selection, () => {
	placeholderFontSourceOverrides.value = {};
});

function placeholderFontSource(inputKey: string): GraphicFontSource {
	return placeholderFontSourceOverrides.value[inputKey]
		?? placeholderStyleFor(inputKey).font?.kind
		?? 'base';
}

function updatePlaceholderFontSource(inputKey: string, source: GraphicFontSource) {
	placeholderFontSourceOverrides.value = { ...placeholderFontSourceOverrides.value, [inputKey]: source };
	const current = placeholderStyleFor(inputKey).font;
	if (source === 'base' && current)
		editItem(patchGraphicPlaceholderStyle, inputKey, { font: undefined });
	else if (source === 'application' && current?.kind !== 'application')
		editItem(patchGraphicPlaceholderStyle, inputKey, { font: applicationGraphicFont(DEFAULT_GRAPHIC_FONT_ID) });
}

/** Pin one exact font Graphic Asset Revision for one placeholder. */
function selectPlaceholderFontAsset(
	inputKey: string,
	_asset: GraphicAsset,
	reference: GraphicAssetReference,
) {
	editItem(patchGraphicPlaceholderStyle, inputKey, { font: { kind: 'asset', reference } });
}

/**
 * Unpinning a library font leaves the placeholder on the item's base typography.
 *
 * The base control falls back to an application font because a `GraphicTypography`
 * must name one; a placeholder need not, so the honest answer here is to remove the
 * property rather than invent a font the author never chose. The arm stays selected,
 * so the picker is still there to pin another.
 */
function clearPlaceholderFontAsset(inputKey: string) {
	placeholderFontSourceOverrides.value = { ...placeholderFontSourceOverrides.value, [inputKey]: 'asset' };
	editItem(patchGraphicPlaceholderStyle, inputKey, { font: undefined });
}
</script>

<template>
	<!--
		A disabled fieldset is what makes the read-only editor read-only in the
		browser rather than merely discouraging: every native control it contains
		stops accepting input. The compositor editing module's lease guard is the
		same rule stated where a programmatic change would otherwise slip through.
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
				@update:model-value="editGraphic(patchBroadcastGraphic, { name: String($event) })"
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
					@click="editGraphic(addGraphicInput, newInputType)"
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
						@click="editGraphic(deleteGraphicInput, input.key)"
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
					<UIColorPicker
						:model-value="input.default ?? '#000000'"
						hex-only
						data-testid="graphic-input-default"
						@update:model-value="updateInput(input.key, { default: String($event) })"
					/>
				</UFormField>

				<!--
					Options first, then which of them a placed Broadcast Graphic starts on.
					The Default offers the declared options and nothing else: a default
					outside them is a value the input reports unavailable, so the graphic
					would start on something it can never show.
				-->
				<template v-else-if="input.type === 'choice'">
					<UFormField
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
					<UFormField label="Default" size="xs">
						<USelect
							:model-value="input.default ?? NO_CHOICE_DEFAULT"
							:items="choiceDefaultOptions(input)"
							class="w-full"
							size="sm"
							data-testid="graphic-input-default"
							@update:model-value="updateChoiceDefault(input.key, String($event))"
						/>
					</UFormField>
				</template>

				<!--
					The declared kind is the whole of what a media Graphic Input constrains,
					and it is the only kind Live Control's picker then offers — so without
					this control a silent-video input cannot be declared at all (#336). The
					default is optional: an author may constrain the kind and leave the
					choice to the operator.
				-->
				<template v-else-if="input.type === 'media'">
					<UFormField label="Media" size="xs">
						<USelect
							:model-value="input.mediaKind"
							:items="MEDIA_KIND_OPTIONS"
							class="w-full"
							size="sm"
							data-testid="graphic-input-media-kind"
							@update:model-value="editGraphic(setGraphicInputMediaKind, input.key, $event as GraphicMediaKind)"
						/>
					</UFormField>
					<UFormField label="Default" size="xs">
						<GraphicsAssetFocusPicker
							:model-value="input.default ?? undefined"
							:event-id="eventId"
							:field-label="input.label"
							:asset-kind="input.mediaKind"
							data-testid="graphic-input-default"
							@update:model-value="$event ? undefined : updateInput(input.key, { default: null })"
							@select="(_asset, reference) => selectInputDefaultAsset(input.key, reference)"
						/>
					</UFormField>
				</template>
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

		<!--
			Social Profile Projections expose correlated, read-only values and own one
			Presentation Group, so they are authored beside — never as — Graphic Inputs
			and Graphic Source Selections. Feature Match hosts do not offer this vocabulary.
		-->
		<GraphicsCompositorSocialProfileProjections
			v-if="selection.kind === 'graphic' && authorsInputs"
			:graphics="graphics"
			:selected-target="selectedTarget"
			:canvas-width="canvasWidth"
			:canvas-height="canvasHeight"
			:writable="writable"
			@update:graphics="emit('update:graphics', $event)"
		/>

		<template v-if="selectedItem">
			<UFormField label="Label" size="sm">
				<UInput
					:model-value="selectedItem.label"
					class="w-full"
					data-testid="graphic-item-label"
					@update:model-value="editItem(patchGraphicItem, { label: String($event) })"
				/>
			</UFormField>

			<UFormField label="Visible" size="sm">
				<USwitch
					:model-value="selectedItem.visible"
					data-testid="graphic-item-visible"
					@update:model-value="editItem(patchGraphicItem, { visible: $event })"
				/>
			</UFormField>

			<GraphicsGeometryFields
				:key="selectedItem.id"
				:rect="selectedItem"
				:container="geometryContainer"
				:anchor="selectedItem.anchor"
				:stacked="!isCanvasPositioned"
				anchor-label="Graphic Anchor Point"
				@update:anchor="editItem(patchGraphicItem, { anchor: $event })"
				@update="editItem(patchGraphicItem, $event)"
			/>

			<UFormField v-if="isCanvasPositioned" label="Graphic Rotation" size="sm">
				<UInputNumber
					:model-value="selectedItem.rotation ?? 0"
					:min="-360"
					:max="360"
					size="sm"
					class="w-full"
					data-testid="graphic-item-rotation"
					aria-label="Graphic Rotation"
					@update:model-value="editItem(patchGraphicItem, { rotation: $event ?? 0 })"
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
						@update:model-value="editItem(patchGraphicGroupChildSizing, { mode: $event as GraphicGroupChildSizing['mode'] })"
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
						@update:model-value="editItem(patchGraphicGroupChildSizing, { size: $event ?? 0 })"
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
						@update:model-value="editItem(patchGraphicGroupChildSizing, { weight: $event ?? 1 })"
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
						@update:model-value="editItem(patchGraphicGroup, { arrangement: $event as never })"
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
							@update:model-value="editItem(patchGraphicGroup, { padding: $event ?? 0 })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Gap" size="sm">
						<UInputNumber
							:model-value="selectedGroup.gap"
							:min="0"
							size="sm"
							class="w-full"
							aria-label="Group gap"
							@update:model-value="editItem(patchGraphicGroup, { gap: $event ?? 0 })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Align" size="sm">
						<USelect
							:model-value="selectedGroup.align"
							:items="ALIGN_OPTIONS"
							value-key="value"
							class="w-full"
							@update:model-value="editItem(patchGraphicGroup, { align: $event as never })"
						/>
					</UFormField>
					<UFormField v-if="selectedGroup.arrangement !== 'canvas'" label="Justify" size="sm">
						<USelect
							:model-value="selectedGroup.justify"
							:items="JUSTIFY_OPTIONS"
							value-key="value"
							class="w-full"
							@update:model-value="editItem(patchGraphicGroup, { justify: $event as never })"
						/>
					</UFormField>
				</div>
				<UFormField label="Clip children" size="sm">
					<USwitch
						:model-value="selectedGroup.clip"
						data-testid="graphic-group-clip"
						@update:model-value="editItem(patchGraphicGroup, { clip: $event })"
					/>
				</UFormField>
				<UFormField label="Child style default" size="sm">
					<USwitch
						:model-value="selectedGroup.defaultChildSurfaceStyle !== undefined"
						data-testid="graphic-group-child-style-default"
						@update:model-value="editItem(patchGraphicGroupDefaultChildSurfaceStyle, $event ? {} : null)"
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
					<UIOpacityInput
						:model-value="selectedGroup.defaultChildSurfaceStyle.fillOpacity"
						size="sm"
						class="w-full"
						aria-label="Child fill opacity"
						@update:model-value="editItem(patchGraphicGroupDefaultChildSurfaceStyle, { fillOpacity: $event ?? 1 })"
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
						@update:model-value="editItem(patchGraphicGroupDefaultChildSurfaceStyle, { fill: { type: 'solid', color: $event?.toString() || '#000000' } })"
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
				@update:model-value="editItem(patchGraphicItem, { playerSide: $event as PlayerSide })"
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
					@update:model-value="editItem(patchPlayerLifeGraphicItem, { lifeAnimation: $event as PlayerLifeAnimation })"
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
						@update:model-value="editItem(patchPlayerLifeGraphicItem, { lifeAnimationDurationMs: $event ?? MIN_PLAYER_LIFE_ANIMATION_DURATION_MS })"
					/>
				</UFormField>
				<!-- Tinted by a glow or slide change only; the others ignore it. -->
				<UFormField label="Accent colour" size="sm">
					<UIColorPicker
						:model-value="selectedPlayerLife.lifeAnimationAccentColor"
						data-testid="player-life-animation-accent"
						@update:model-value="editItem(patchPlayerLifeGraphicItem, { lifeAnimationAccentColor: $event?.toString() || '#ffffff' })"
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
						@update:model-value="editItem(patchGameWinsGraphicItem, { displayMode: $event as GameWinsDisplayMode })"
					/>
				</UFormField>
				<UFormField v-if="selectedGameWins.displayMode === 'boxes'" label="Box orientation" size="sm">
					<USelect
						:model-value="selectedGameWins.boxOrientation"
						:items="GAME_WINS_BOX_ORIENTATION_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="game-wins-box-orientation"
						@update:model-value="editItem(patchGameWinsGraphicItem, { boxOrientation: $event as GameWinsBoxOrientation })"
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
						@update:model-value="editItem(patchGameWinsGraphicItem, { boxWidth: Math.max(1, $event ?? 1) })"
					/>
				</UFormField>
				<UFormField label="Box height" size="sm">
					<UInputNumber
						:model-value="selectedGameWins.boxHeight"
						:min="1"
						size="sm"
						class="w-full"
						aria-label="Win box height"
						@update:model-value="editItem(patchGameWinsGraphicItem, { boxHeight: Math.max(1, $event ?? 1) })"
					/>
				</UFormField>
				<UFormField label="Box gap" size="sm">
					<UInputNumber
						:model-value="selectedGameWins.boxGap"
						:min="0"
						size="sm"
						class="w-full"
						aria-label="Win box gap"
						@update:model-value="editItem(patchGameWinsGraphicItem, { boxGap: $event ?? 0 })"
					/>
				</UFormField>
			</div>
		</div>

		<!--
			A Deck List Item's own controls. The bounds are the only sizing an author
			does: the grid view auto-fits rows, columns, and card size from them and
			the live card count, so there are deliberately no layout knobs here.
		-->
		<div v-if="selectedDeckList" class="rounded-lg border border-default/70 p-3 space-y-2">
			<p class="text-xs font-semibold text-muted">
				Deck List
			</p>
			<div class="grid grid-cols-2 gap-2">
				<UFormField label="View" size="sm">
					<USelect
						:model-value="selectedDeckList.view"
						:items="DECK_LIST_VIEW_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="deck-list-view"
						@update:model-value="editItem(patchDeckListGraphicItem, { view: $event as DeckListView })"
					/>
				</UFormField>
				<UFormField label="Show quantities" size="sm">
					<USwitch
						:model-value="selectedDeckList.showQuantities"
						data-testid="deck-list-show-quantities"
						@update:model-value="editItem(patchDeckListGraphicItem, { showQuantities: $event })"
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
					@update:model-value="editItem(patchTextGraphicItem, { text: String($event) })"
				/>
			</UFormField>

			<!--
				Every placeholder this template may name, offered to reference rather
				than to author. A Feature Match Overlay's vocabulary is its host's fixed
				catalogue; a Broadcast Graphic's is its own declared Graphic Inputs —
				and both are keys the author must reproduce exactly, so the useful
				control is one that appends a valid one. The declared side used to be
				missing entirely, which left the key visible only in the Graphic Inputs
				panel of a *different* selection (#234).
			-->
			<UFormField v-if="availablePlaceholders.length > 0" label="Placeholders" size="sm">
				<div class="flex flex-wrap gap-1" data-testid="graphic-host-tokens">
					<UButton
						v-for="token in availablePlaceholders"
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
						<span class="text-muted">{{ token.label }}</span>
					</UButton>
				</div>
			</UFormField>

			<!--
				A placeholder nothing resolves renders as nothing, which is right for
				the output and silent for the author. This is where the silence is
				broken.
			-->
			<p
				v-if="unresolvedPlaceholders.length > 0"
				class="text-xs text-warning"
				data-testid="unresolved-placeholders"
			>
				Nothing declares
				{{ unresolvedPlaceholders.map(placeholderToken).join(', ') }}, so
				{{ unresolvedPlaceholders.length === 1 ? 'it renders' : 'they render' }}
				nothing.
				<template v-if="availablePlaceholderKeys.length > 0">
					This composition offers
					{{ availablePlaceholderKeys.map(placeholderToken).join(', ') }} — a
					Graphic Input is named and keyed separately, and a template names the key.
				</template>
				<template v-else>
					This composition declares no Graphic Inputs yet.
				</template>
			</p>
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

			<GraphicsTypographyFields
				:typography="selectedTypography"
				test-id-prefix="typography"
				@update="editItem(patchGraphicTypography, $event)"
			>
				<!--
					A font is either one that ships with Stream Keepr or one exact font
					Graphic Asset Revision from the Graphics Asset Library. The same control
					a Graphic Placeholder Style below offers, less its third answer: a
					`GraphicTypography` must name a font, so "same as base" is not one here.
				-->
				<template #font>
					<GraphicsCompositorFontSelectionField
						:source="fontSource"
						:font="selectedFont"
						:event-id="eventId"
						field-label="Typography"
						size="sm"
						test-id-prefix="typography"
						@update:source="updateFontSource"
						@application="editItem(patchGraphicTypography, { font: applicationGraphicFont($event) })"
						@select="selectFontAsset"
						@clear="clearFontAsset"
					/>
				</template>
				<template #color>
					<UFormField label="Align" size="sm">
						<USelect
							:model-value="selectedTypography.textAlign"
							:items="TEXT_ALIGN_OPTIONS"
							value-key="value"
							class="w-full"
							@update:model-value="editItem(patchGraphicTypography, { textAlign: $event as never })"
						/>
					</UFormField>
					<UFormField label="Colour" size="sm">
						<UIColorPicker
							:model-value="selectedTypography.color"
							@update:model-value="editItem(patchGraphicTypography, { color: $event?.toString() || '#ffffff' })"
						/>
					</UFormField>
				</template>
			</GraphicsTypographyFields>
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
					@update:model-value="editItem(patchGraphicTextOverflow, { overflowPolicy: $event })"
				/>
			</UFormField>

			<UFormField
				v-if="selectedTextOverflow.overflowPolicy === 'shrink'"
				label="Minimum font size"
				size="sm"
			>
				<UInputNumber
					:model-value="selectedTextOverflow.minFontSize"
					:min="MIN_GRAPHIC_FONT_SIZE"
					:max="MAX_GRAPHIC_FONT_SIZE"
					size="sm"
					class="w-full"
					data-testid="text-min-font-size"
					aria-label="Minimum font size"
					@update:model-value="editItem(patchGraphicTextOverflow, { minFontSize: $event ?? 1 })"
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
						@click="editItem(patchGraphicPlaceholderStyle, inputKey, null)"
					>
						Use base
					</UButton>
				</div>
				<GraphicsTypographyFields
					:typography="placeholderStyleFor(inputKey)"
					inheritable
					size="xs"
					test-id-prefix="graphic-placeholder-style"
					@update="editItem(patchGraphicPlaceholderStyle, inputKey, $event)"
				>
					<!--
						A placeholder's own Graphic Font Selection. The same control as the base
						typography above, with the one answer a placeholder has and it does not:
						a font is optional here, so "same as base" is a real answer. What the two
						do with an unpinned library arm differs, which is why the answer arrives
						here rather than being settled inside the control.
					-->
					<template #font>
						<GraphicsCompositorFontSelectionField
							:source="placeholderFontSource(inputKey)"
							:font="placeholderStyleFor(inputKey).font"
							optional
							:event-id="eventId"
							:field-label="`Placeholder ${placeholderToken(inputKey)}`"
							size="xs"
							test-id-prefix="graphic-placeholder-style"
							@update:source="source => updatePlaceholderFontSource(inputKey, source)"
							@application="editItem(patchGraphicPlaceholderStyle, inputKey, { font: applicationGraphicFont($event) })"
							@select="(asset, reference) => selectPlaceholderFontAsset(inputKey, asset, reference)"
							@clear="clearPlaceholderFontAsset(inputKey)"
						/>
					</template>
					<template #color>
						<UFormField label="Colour" size="xs" class="col-span-2">
							<UIColorPicker
								:model-value="placeholderStyleFor(inputKey).color ?? selectedTextItem.typography.color"
								data-testid="graphic-placeholder-style-color"
								@update:model-value="editItem(patchGraphicPlaceholderStyle, inputKey, { color: $event?.toString() || undefined })"
							/>
						</UFormField>
					</template>
				</GraphicsTypographyFields>
			</div>
		</template>

		<template v-if="selectedSocialNetworkIcon">
			<div class="rounded-lg border border-default/70 p-3 space-y-2">
				<p class="text-xs font-semibold text-muted">
					Social Network Icon
				</p>
				<UFormField label="Network source" size="sm">
					<USelect
						:model-value="typeof selectedSocialNetworkIcon.network === 'string' ? 'static' : 'projection'"
						:items="SOCIAL_NETWORK_ICON_SOURCE_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="social-network-icon-source"
						@update:model-value="updateSocialNetworkIconSource($event as 'static' | 'projection')"
					/>
				</UFormField>
				<UFormField v-if="typeof selectedSocialNetworkIcon.network === 'string'" label="Social network" size="sm">
					<USelect
						:model-value="selectedSocialNetworkIcon.network"
						:items="SOCIAL_NETWORK_OPTIONS"
						value-key="value"
						class="w-full"
						data-testid="social-network-icon-network"
						@update:model-value="editItem(patchGraphicItem, { network: $event as SupportedSocialNetwork })"
					/>
				</UFormField>
				<UFormField v-else label="Social Profile Projection" size="sm">
					<USelect
						:model-value="selectedSocialNetworkIcon.network.projectionKey"
						:items="socialProfileProjectionOptions"
						value-key="value"
						class="w-full"
						data-testid="social-network-icon-projection"
						@update:model-value="editItem(patchGraphicItem, { network: { projectionKey: String($event) } })"
					/>
				</UFormField>
				<p
					v-if="invalidSocialNetworkIconProjection"
					class="text-xs text-warning"
					data-testid="social-network-icon-projection-invalid"
				>
					This icon is outside that projection's Presentation Group. Move or replace it before saving.
				</p>
				<div class="grid grid-cols-2 gap-2">
					<UFormField label="Colour" size="sm">
						<UIColorPicker
							:model-value="selectedSocialNetworkIcon.color"
							data-testid="social-network-icon-color"
							@update:model-value="editItem(patchGraphicItem, { color: $event?.toString() || '#ffffff' })"
						/>
					</UFormField>
					<UFormField label="Opacity" size="sm">
						<UIOpacityInput
							:model-value="selectedSocialNetworkIcon.opacity"
							size="sm"
							class="w-full"
							data-testid="social-network-icon-opacity"
							aria-label="Social network icon opacity"
							@update:model-value="editItem(patchGraphicItem, { opacity: $event ?? 1 })"
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
					pinned it.
				-->
				<UFormField label="Graphic Asset" size="sm">
					<GraphicsAssetFocusPicker
						:model-value="selectedMediaItem.asset"
						:event-id="eventId"
						field-label="Media Graphic Item"
						:asset-kind="['image', 'silent-video']"
						@update:model-value="$event ? undefined : editItem(clearMediaGraphicItemAsset)"
						@select="selectMediaAsset"
					/>
				</UFormField>

				<!--
					Playback belongs to a silent video, so an image item is offered
					neither control even though it stores both — switching an item back to
					a video restores the playback its author already set up.
				-->
				<GraphicsMediaFields
					:media="selectedMediaItem"
					opacity
					focal
					:playback="selectedMediaItem.mediaKind === 'silent-video'"
					@update="updateMediaFields"
				/>
				<p v-if="selectedMediaItem.mediaKind === 'silent-video'" class="text-xs text-muted">
					Video is silent, and starts from its beginning when its Broadcast Graphic enters.
				</p>

				<UFormField label="Clip to Shape Geometry" size="sm">
					<USwitch
						:model-value="selectedMediaItem.clipGeometry !== undefined"
						data-testid="media-clip-enabled"
						@update:model-value="editItem(setMediaClipGeometry, $event)"
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
				<GraphicsShapeGeometryFields
					:geometry="selectedGeometry"
					@update="editItem(patchShapeGeometry, $event)"
					@preset="editItem(applyShapeGeometryPreset, $event)"
				/>
			</div>
		</template>

		<!--
			A Media Graphic Item paints an asset, a Social Network Icon paints its
			application vector, and a Deck List Item renders cards, so none is offered a
			surface. Every other kind gets them three times over — its own surface,
			and the two that paint a win box before and after the Player wins it.
		-->
		<GraphicsCompositorSurfaceStyleFields
			v-if="selectedItem && selectedItem.type !== 'media' && selectedItem.type !== 'social-network-icon'
				&& selectedItem.type !== 'deck-list'"
			:surface-style="ownSurfaceStyle"
			title="Graphic Surface Style"
			:presence-label="parentGroup ? 'Override group style default' : 'Paint a surface'"
			@edit="editItem(applyGraphicSurfaceStyleEdit, 'surfaceStyle', $event)"
		>
			<template #style-ref>
				<!--
					Two references, because a surface entry may itself carry a Graphic Fill
					entry and an author may want the brand surface with this one gradient.
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
				@edit="editItem(applyGraphicSurfaceStyleEdit, 'boxSurfaceStyle', $event)"
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
				@edit="editItem(applyGraphicSurfaceStyleEdit, 'wonBoxSurfaceStyle', $event)"
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
			:canvas-width="canvasWidth"
			:canvas-height="canvasHeight"
			@update:graphics="emit('update:graphics', $event)"
		/>
	</fieldset>
</template>
