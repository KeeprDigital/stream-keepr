import type { AnimationEffectSelection, BroadcastGraphicsBackgroundConfig, FeatureMatchOverlayFrameAnimationConfig } from '../animationEffects';
import type { CardTypeBucket } from '../utils/metagame';
import type { BoardSelection, CardAnimationSpeed, DeckBoardView, DeckCardSize, HorizontalAlign, MetagameArchetypeColumnKey, MetagameCardColumnKey, MetagameCardSortBy, MetagameScope, MetagameSortBy, MetagameViewMode, PlayerHistoryColumnKey, PlayerSide, QuantityPosition, QuantitySize, RevealOrder, RevealTrigger, ScreenColorMode, ScreenMode, SideboardPlacement, StandingsColumnKey, StandingsViewMode, TopCardsStat, VerticalAlign } from './enums';
import type { BroadcastGraphicConfig, GraphicChannelConfig } from './graphics';
import type { GraphicAssetId, GraphicAssetReference, GraphicAssetRevisionId } from './graphicsAsset';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../featureMatchOverlayPresets';
import { DEFAULT_BROADCAST_GRAPHICS_BACKGROUND, DEFAULT_FRAME_ANIMATION, DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '../screenGraphicsDefaults';

/**
 * A Screen's media background, a Feature Match Overlay Frame's animation, and a
 * Broadcast Graphics Background take their starting values from their own module,
 * so the Feature Match Overlay Presets can build a Frame without importing this
 * one back. They are re-exported here because this is where every other mode
 * default lives.
 */
export { DEFAULT_BROADCAST_GRAPHICS_BACKGROUND, DEFAULT_FRAME_ANIMATION, DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG };
export { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG };

// ─── Screen-level config (applies to all modes) ───────────────────────
export interface ScreenConfig {
	background?: string;
	width?: number;
	height?: number;
	paddingX?: number;
	paddingY?: number;
	primaryTextColor?: string;
	secondaryTextColor?: string;
	colorMode?: ScreenColorMode;
	horizontalAlign?: HorizontalAlign;
	verticalAlign?: VerticalAlign;
}

export const DEFAULT_SCREEN_CONFIG: ScreenConfig = {
	horizontalAlign: 'center',
	verticalAlign: 'center',
};

// ─── Mode-specific configs ─────────────────────────────────────────────

/**
 * One board's complete layout block. The Mainboard and Sideboard each carry
 * their own (#478): which view renders the board, and the knobs each view
 * reads — grid reads columns/gap/sizing, list reads listColumns, stack reads
 * cardSize and stackOverlap.
 */
export interface DeckBoardLayoutConfig {
	view?: DeckBoardView;
	columns?: number;
	listColumns?: number;
	cardSize?: DeckCardSize;
	dynamicCardSize?: boolean;
	cardGap?: number;
	/** Percentage of each stacked card left visible under the next one. */
	stackOverlap?: number;
}

export type DeckSource
	= | { type: 'player'; playerId: number | null }
		| { type: 'broadcast'; broadcastDeckListId: number };

export interface DeckModeConfig {
	deckSource: DeckSource;
	/** Which boards render (#477). "Both hidden" is impossible by construction. */
	board?: BoardSelection;
	/** Where the sideboard sits relative to the mainboard. Read only at `board: 'full'`. */
	sideboardPlacement?: SideboardPlacement;
	mainboard?: DeckBoardLayoutConfig;
	sideboard?: DeckBoardLayoutConfig;
	showQuantities?: boolean;
	showDeckName?: boolean;
	showDeckColors?: boolean;
	showDeckStats?: boolean;
	showDeckMetaPill?: boolean;
	deckMetaPillSize?: QuantitySize;
	deckMetaPillTextColor?: string;
	deckMetaPillBgColor?: string;
	deckMetaPillAccentColor?: string;
	deckMetaPillBorderColor?: string;
	showHighlanderTotal?: boolean;
	showHighlanderPointedCards?: boolean;
	highlanderPointedCardsSize?: QuantitySize;
	highlanderPointedCardsTextColor?: string;
	highlanderPointedCardsBgColor?: string;
	highlanderPointedCardsAccentColor?: string;
	highlanderPointedCardsBorderColor?: string;
	showHighlanderPoints?: boolean;
	highlanderPointsPosition?: QuantityPosition;
	highlanderPointsSize?: QuantitySize;
	highlanderPointsTextColor?: string;
	highlanderPointsBgColor?: string;

	// Quantity badge customization
	quantityPosition?: QuantityPosition;
	quantitySize?: QuantitySize;
	quantityTextColor?: string;
	quantityBgColor?: string;
}

export interface CardDisplayConfig {
	// Card sizing
	scale?: number; // 0.5 - 2.0 multiplier

	// Animation
	animationEnabled?: boolean;
	animationSpeed?: CardAnimationSpeed;
}

export interface CardModeConfig extends CardDisplayConfig {
	// Optional feature match binding (for decklist convenience, not required)
	featureMatchId?: number | null;
}

export interface StandingsColumnConfig {
	key: StandingsColumnKey;
	visible: boolean;
}

export interface MetagameArchetypeColumnConfig {
	key: MetagameArchetypeColumnKey;
	visible: boolean;
}

export interface MetagameCardColumnConfig {
	key: MetagameCardColumnKey;
	visible: boolean;
}

export interface PlayerHistoryColumnConfig {
	key: PlayerHistoryColumnKey;
	visible: boolean;
}

export interface StandingsModeConfig {
	// View mode
	viewMode: StandingsViewMode;

	// Column configuration (ordered array — order = display order)
	columns: StandingsColumnConfig[];
	showArchetypeColors: boolean;
	maxTableWidth?: number;
	roundId?: number;

	// Header
	showHeader: boolean;
	headerText?: string;

	// Top N mode
	topNCount: number;

	// Slice mode
	sliceStart: number;
	sliceEnd: number;

	// Watchlist mode
	playerListId?: number;

	// Reveal mode
	revealCount: number;
	revealOrder: RevealOrder;
	revealTrigger: RevealTrigger;
	revealIntervalMs: number;
	revealedCount: number;

	// Pagination — currentPage is the manually selected page (auto-page off);
	// rotationAnchor is the Page Rotation's epoch (auto-page on), written only
	// by operator surfaces and projected against server time by every rendering.
	rowsPerPage: number;
	autoPageEnabled: boolean;
	autoPageIntervalMs: number;
	currentPage?: number;
	rotationAnchor?: number;

	// Animation
	animateEntries: boolean;
}

export interface TopCutModeConfig {
	// Placeholder for top cut mode config
	bracketSize?: number;
}

export interface FeatureMatchModeConfig {
	featureMatchId: number | null;
	showNames: boolean;
	showRecords: boolean;
	showDeckNames: boolean;
	showPronouns: boolean;
	showClock: boolean;
	showCounters: boolean;
	showSeatLabels?: boolean;
	// Layout — which player data slot renders on the left side of the screen
	leftSidePlayer?: PlayerSide;
	// Turn controls — show the turn/active-player widget
	showTurnControls?: boolean;
	// Overtime — show the extra turns tracker when overtime begins
	showOvertime?: boolean;
	// Mulligan info — show the cards kept indicator
	showMulliganInfo?: boolean;
	// LGS — show the player's Local Game Store
	showLgs?: boolean;
	// Table number — show the feature match table number in the header
	showTableNumber?: boolean;
	// Control permissions — what players can do from the control screen
	allowLifeControls?: boolean;
	allowGameWinControls?: boolean;
	allowCounterControls?: boolean;
}

export interface PlayerHistoryModeConfig {
	playerId: number | null;
	columns: PlayerHistoryColumnConfig[];
	showHeader: boolean;
	headerText?: string;
	rowsPerPage: number;
	autoPageEnabled: boolean;
	autoPageIntervalMs: number;
	currentPage?: number;
	rotationAnchor?: number;
}

export type FeatureMatchOverlayPresetId = 'full-table' | 'left-stacked-player-cams' | 'neon-feature-match';
/** The live rendering variants a graphics Screen Mode Definition exposes. */
export type ScreenOutput = 'overlay' | 'fill' | 'key';
export type FeatureMatchOverlayOutput = ScreenOutput;
export const DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH = 1920;
export const DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT = 1080;
export const FEATURE_MATCH_OVERLAY_ANCHOR_VALUES = [
	'top-left',
	'top',
	'top-right',
	'left',
	'center',
	'right',
	'bottom-left',
	'bottom',
	'bottom-right',
] as const;
export type FeatureMatchOverlayAnchorValue = typeof FEATURE_MATCH_OVERLAY_ANCHOR_VALUES[number];
export type ScreenMediaBackgroundType = 'video';
export type ScreenMediaBackgroundFit = 'cover' | 'contain' | 'fill';

/**
 * What a Source Item declares instead of a camera.
 *
 * A closed vocabulary rather than free text, because a role is the only thing a
 * Source Item carries that survives leaving this installation. A Feature Match
 * Layout Template travels with "there is a main source here and a player-one
 * source there"; a receiving installation routes its own inputs into those roles.
 * A free-form string would travel as an operator's local shorthand — `cam-3-left`
 * means nothing to the show that receives it, and nothing could tell it from a
 * role the receiver does implement.
 *
 * Pinned by the Source Item Definition's configuration version: adding a role is
 * a change to what a Feature Match Layout can say, so a package using a new one is
 * refused by an installation that predates it rather than silently framing nothing.
 */
export const FEATURE_MATCH_SOURCE_ROLE_VALUES = ['main', 'player1', 'player2'] as const;

export type FeatureMatchSourceRole = typeof FEATURE_MATCH_SOURCE_ROLE_VALUES[number];

export interface FeatureMatchOverlayRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface FeatureMatchOverlayBorderSides {
	borderTopVisible?: boolean;
	borderRightVisible?: boolean;
	borderBottomVisible?: boolean;
	borderLeftVisible?: boolean;
}

/**
 * The surface treatment of a host-owned Feature Match Overlay element.
 *
 * Only the Frame and Source Items carry one. It keeps the per-side border
 * visibility and per-corner radii the Frame has always drawn, because those are
 * host capability the Host Contract leaves with the host — the drop of per-side
 * borders is a drop from the shared Graphic Surface Style, where a composed rule
 * Shape Graphic Item replaces them.
 *
 * It carries no typography, padding, or overflow. Those belonged to the legacy
 * widget model, and a Source Item paints a bordered hole rather than text.
 *
 * `backgroundGradient` is a raw CSS gradient string, as the Frame's own
 * `gradient` is. The shared Graphic Fill replaced arbitrary CSS with a bounded
 * two-to-four-stop gradient, but that is a rule for the shared vocabulary — the
 * host layer keeps the string it always painted, and keeping it here and on the
 * Frame means the two host-owned surfaces state the same capability.
 */
export interface FeatureMatchSourceFramingStyle extends FeatureMatchOverlayBorderSides {
	backgroundColor?: string;
	backgroundOpacity?: number;
	backgroundGradient?: string;
	borderVisible?: boolean;
	borderColor?: string;
	borderWidth?: number;
	borderRadius?: number;
	borderRadiusTopLeft?: number;
	borderRadiusTopRight?: number;
	borderRadiusBottomRight?: number;
	borderRadiusBottomLeft?: number;
	glowColor?: string;
	glowSize?: number;
	glowOpacity?: number;
}

export interface ScreenMediaBackgroundConfig {
	enabled: boolean;
	type: ScreenMediaBackgroundType;
	url: string;
	fit: ScreenMediaBackgroundFit;
	opacity: number;
	playbackRate: number;
	loop: boolean;
}

/**
 * Where a Screen's media comes from: a Graphics Asset Library revision, or a
 * remote URL.
 *
 * This is the standardised media source shape the Background Screen mints and
 * the rest of the application adopts over time (#484). An asset source pins an
 * exact revision and carries the same facts a media Graphic Input value does —
 * `videoCompatibility` recorded at the moment of selection, because nothing
 * downstream can go and ask the library for it. A URL source is the escape
 * hatch the old media background always was: the application serves nothing and
 * checks nothing.
 */
export type ScreenMediaSource
	= | { kind: 'asset'; assetId: GraphicAssetId; revisionId: GraphicAssetRevisionId; videoCompatibility?: 'all-supported' | 'chromium-transparency' }
		| { kind: 'url'; url: string };

export const BACKGROUND_LAYER_TYPE_VALUES = ['color', 'gradient', 'image', 'video', 'animation'] as const;
export type BackgroundLayerType = typeof BACKGROUND_LAYER_TYPE_VALUES[number];

/**
 * What every Background Layer owns regardless of its type: its identity, its
 * own enabled state, and its own opacity. Opacity belongs to the layer — never
 * to the stack or to the renderer behind it — so stacking a translucent colour
 * over an Animation Effect is one layer's setting, not a mode-level knob.
 * Ids are how a reorder stays a reorder rather than a rewrite.
 */
interface BackgroundLayerBase {
	id: string;
	enabled: boolean;
	opacity: number;
}

export interface ColorBackgroundLayer extends BackgroundLayerBase {
	type: 'color';
	color: string;
}

/** `gradient` is a raw CSS gradient string, as the Feature Match Overlay Frame's is. */
export interface GradientBackgroundLayer extends BackgroundLayerBase {
	type: 'gradient';
	gradient: string;
}

export interface ImageBackgroundLayer extends BackgroundLayerBase {
	type: 'image';
	source: ScreenMediaSource;
	fit: ScreenMediaBackgroundFit;
}

export interface VideoBackgroundLayer extends BackgroundLayerBase {
	type: 'video';
	source: ScreenMediaSource;
	fit: ScreenMediaBackgroundFit;
	playbackRate: number;
	loop: boolean;
}

export interface AnimationBackgroundLayer extends BackgroundLayerBase {
	type: 'animation';
	animation: AnimationEffectSelection;
}

/**
 * One entry in a Background Screen's ordered stack. Painter's order: the first
 * layer is the bottom of the stack.
 */
export type BackgroundLayer
	= | ColorBackgroundLayer
		| GradientBackgroundLayer
		| ImageBackgroundLayer
		| VideoBackgroundLayer
		| AnimationBackgroundLayer;

/**
 * The Feature Match Overlay Frame's animation effects.
 *
 * A closed vocabulary for the same reason a Source Role is: an effect names an
 * Animation Effect renderer that ships with Stream Keepr, so a Feature Match
 * Layout Template carries the name and the receiving installation supplies the
 * renderer. One it does not implement is a capability it lacks, not a value it
 * can approximate. The vocabulary, and each effect's own params, live in the
 * Animation Effect catalogue (`shared/animationEffects.ts`); this module
 * re-exports them under the Frame's names so Screen configuration keeps one
 * import.
 */
export { ANIMATION_EFFECT_VALUES as FEATURE_MATCH_OVERLAY_FRAME_ANIMATION_EFFECT_VALUES } from '../animationEffects';
export type { FeatureMatchOverlayFrameAnimationConfig, AnimationEffectName as FeatureMatchOverlayFrameAnimationEffect } from '../animationEffects';

/**
 * A Broadcast Graphics Screen's background, for the same reason and on the same
 * terms as the Frame's animation above: the Animation Effect catalogue owns the
 * vocabulary and each effect's params, and Screen configuration re-exports the
 * host's config type so it keeps one import.
 */
export type { BroadcastGraphicsBackgroundConfig } from '../animationEffects';

export type FeatureMatchOverlayPlayerLifeAnimation = 'none' | 'fade' | 'pop' | 'slide' | 'glow';

export interface FeatureMatchOverlayFrameConfig extends FeatureMatchOverlayBorderSides {
	backgroundColor: string;
	opacity: number;
	backgroundImage?: GraphicAssetReference;
	backgroundImageFit?: 'cover' | 'contain' | 'fill';
	mediaBackground?: ScreenMediaBackgroundConfig;
	gradient?: string;
	animation?: FeatureMatchOverlayFrameAnimationConfig;
	borderVisible?: boolean;
	borderColor?: string;
	borderWidth?: number;
	glowColor?: string;
	glowSize?: number;
	glowOpacity?: number;
}

export interface FeatureMatchLayoutFrameConfig extends FeatureMatchOverlayFrameConfig {}

/**
 * A host-owned Source Item: an external video source area inside a Feature Match
 * Layout, with optional Frame cutout behaviour and its own framing style.
 *
 * Source Items are the one Feature Match Overlay-specific Graphic Item
 * Definition. They stay host-owned because no Broadcast Graphics Screen has an
 * external video source to place and a Frame cutout is a Frame concern, and they
 * are top-level only — a Graphic Group never contains one.
 */
export interface FeatureMatchSourceItemConfig extends FeatureMatchOverlayRect {
	id: string;
	label: string;
	visible: boolean;
	anchor?: FeatureMatchOverlayAnchorValue;
	configurationVersion?: number;
	sourceRole?: FeatureMatchSourceRole;
	frameCutout: boolean;
	framingStyle?: FeatureMatchSourceFramingStyle;
}

/**
 * The authored arrangement a Feature Match Overlay renders.
 *
 * It carries three things, and the Host Contract draws the line between them:
 *
 * - `frame` is the Feature Match Overlay Frame: the continuous graphic area
 *   behind and around everything else. It stays host-owned — backgrounds, media,
 *   shader animation effects, per-side border, and glow are capability outside the
 *   shared vocabulary, and the contract's rule is that capability outside the
 *   contract stays with the host.
 * - `sources` is the host-owned Source Items, back to front. They have their own
 *   list rather than sharing the composition's, because they are a host-specific
 *   Definition the shared vocabulary cannot express and because the compositor is
 *   mounted above the Frame and the Source Items as one layer.
 * - `composition` is the shared Graphic Item tree, held as exactly one
 *   composition because a Feature Match Overlay renders exactly one Feature Match
 *   Layout. It is a `BroadcastGraphicConfig` because that is the shape the shared
 *   compositor authors and the shared render model composes, not because a Feature
 *   Match Layout is a Broadcast Graphic.
 *
 * There is no fourth field. The legacy widget, widget-group, and numeric z-index
 * model is gone, and nothing converts one: the database is wiped before ship and
 * capability is verified by `docs/feature-match-overlay-capability-parity.md`
 * instead of by a migration.
 */
export interface FeatureMatchLayoutConfig {
	frame: FeatureMatchLayoutFrameConfig;
	/** Graphic Layer Order of the host-owned Source Items, back to front. */
	sources: FeatureMatchSourceItemConfig[];
	/** The shared Graphic Item tree, composed above the Frame and the Source Items. */
	composition: BroadcastGraphicConfig;
}

export interface FeatureMatchOverlayModeConfig {
	featureMatchId: number | null;
	presetId: FeatureMatchOverlayPresetId;
	layout: FeatureMatchLayoutConfig;
}

export const DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH = 1920;
export const DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT = 1080;

/**
 * Screen-owned Broadcast Graphics mode configuration.
 *
 * `graphics` is the Screen's authored back-to-front stack of Broadcast
 * Graphics; concurrent graphics always render in this order. `channels` declares
 * the Screen's Graphic Channels, which each graphic joins by id — a lane is a
 * design decision about the show, so it is authored here, while which member a
 * channel currently holds is derived from the Live Session's playout intents.
 * The Screen's one configurable pixel canvas remains the Screen's own width and
 * height, and playout, inputs, and animation are live state rather than authored
 * configuration.
 */
export interface BroadcastGraphicsModeConfig {
	graphics: BroadcastGraphicConfig[];
	/** Absent declares no Graphic Channels, so every graphic runs concurrently. */
	channels?: GraphicChannelConfig[];
	/**
	 * The Screen's Broadcast Graphics Background: one Animation Effect the stack
	 * composes over. Absent is no background, which is what every Screen ships as
	 * and what keeps an Overlay Output transparent behind its graphics.
	 */
	background?: BroadcastGraphicsBackgroundConfig;
}

export interface MetagameModeConfig {
	// View selection
	viewMode: MetagameViewMode;

	// Scoping
	scope: MetagameScope;
	topN: number;
	playerListId?: number;
	archetypeFilter?: string;

	// Sorting
	sortBy: MetagameSortBy;
	cardSortBy: MetagameCardSortBy;

	// Column configuration (ordered arrays — order = display order)
	archetypeColumns: MetagameArchetypeColumnConfig[];
	cardColumns: MetagameCardColumnConfig[];

	// Display limits
	limit: number;
	maxTableWidth?: number | null;

	// Pagination
	pageSize: number;
	autoPageEnabled: boolean;
	autoPageIntervalMs: number;
	currentPage?: number;
	rotationAnchor?: number;

	// Visibility toggles
	showHeader: boolean;
	headerText?: string;

	// Animation
	animateEntries: boolean;
}

/**
 * The Top Cards Screen: a ranked grid of the most played cards in the event's
 * metagame, rendered as card images the way the Deck Screen renders a deck.
 * Scoping reuses the Metagame vocabulary; `excludedCardTypes` is applied
 * server-side before `limit`, so a filtered top N still fills N slots.
 */
export interface TopCardsModeConfig {
	// Scoping (same vocabulary as the Metagame mode)
	scope: MetagameScope;
	topN: number;
	playerListId?: number;
	archetypeFilter?: string;

	// Data selection & filtering
	board: BoardSelection;
	sortBy: MetagameCardSortBy;
	limit: number;
	excludedCardTypes: CardTypeBucket[];

	// Grid layout
	columns: number;
	cardSize: DeckCardSize;
	dynamicCardSize: boolean;
	cardGap: number;

	// Header
	showHeader: boolean;
	headerText?: string;

	// Card labels & badges
	showCardNames: boolean;
	showRankBadges: boolean;
	rankBadgeTextColor?: string;
	rankBadgeBgColor?: string;
	/** Which metric the stat badge shows; 'none' hides the badge. */
	statBadge: TopCardsStat;
	statBadgeSize?: QuantitySize;
	statBadgeTextColor?: string;
	statBadgeBgColor?: string;
}

// Union type for all mode configs
export type ScreenModeConfig = DeckModeConfig | CardModeConfig | BackgroundModeConfig | StandingsModeConfig | TopCutModeConfig | FeatureMatchModeConfig | FeatureMatchOverlayModeConfig | BroadcastGraphicsModeConfig | MetagameModeConfig | TopCardsModeConfig | PlayerHistoryModeConfig;

/**
 * The Background Screen's configuration: an ordered stack of Background Layers,
 * replacing the former Idle mode's single optional media background. The old
 * `mediaBackground` config resets rather than mapping onto a layer — the
 * ADR-0014 reset precedent, accepted for the same small install base.
 */
export interface BackgroundModeConfig {
	layers: BackgroundLayer[];
}

/** A fresh Background Screen starts empty — black until configured. */
export const DEFAULT_BACKGROUND_CONFIG: BackgroundModeConfig = {
	layers: [],
};

export const DEFAULT_CARD_DISPLAY_CONFIG: CardDisplayConfig = {
	scale: 1,
	animationEnabled: true,
	animationSpeed: 'normal',
};

export const DEFAULT_CARD_CONFIG: CardModeConfig = {
	featureMatchId: null,
	...DEFAULT_CARD_DISPLAY_CONFIG,
};

export type ResolvedDeckBoardLayout = Required<DeckBoardLayoutConfig>;

export const DEFAULT_DECK_BOARD_LAYOUT: ResolvedDeckBoardLayout = {
	view: 'grid',
	columns: 4,
	listColumns: 2,
	cardSize: 'medium',
	dynamicCardSize: false,
	cardGap: 8,
	stackOverlap: 15,
};

const DEFAULT_SIDEBOARD_LAYOUT: ResolvedDeckBoardLayout = {
	...DEFAULT_DECK_BOARD_LAYOUT,
	view: 'stack',
};

export interface ResolvedDeckBoards {
	board: BoardSelection;
	sideboardPlacement: SideboardPlacement;
	mainboard: ResolvedDeckBoardLayout;
	sideboard: ResolvedDeckBoardLayout;
}

/**
 * Completes a Deck configuration's board selection and board blocks from their
 * defaults. Stored blocks are partial fragments — a PATCH may have written a
 * lone `{ columns: 6 }` — so every rendering and settings surface resolves
 * through this rather than reading the fragments directly.
 */
export function resolveDeckBoards(config: Partial<DeckModeConfig>): ResolvedDeckBoards {
	return {
		board: config.board ?? 'full',
		sideboardPlacement: config.sideboardPlacement ?? 'beside',
		mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT, ...config.mainboard },
		sideboard: { ...DEFAULT_SIDEBOARD_LAYOUT, ...config.sideboard },
	};
}

export const DEFAULT_DECK_CONFIG: DeckModeConfig = {
	deckSource: { type: 'player', playerId: null },
	board: 'full',
	sideboardPlacement: 'beside',
	mainboard: { ...DEFAULT_DECK_BOARD_LAYOUT },
	sideboard: { ...DEFAULT_SIDEBOARD_LAYOUT },
	showQuantities: true,
	showDeckName: true,
	showDeckColors: true,
	showDeckStats: false,
	showDeckMetaPill: true,
	deckMetaPillSize: 'medium',
	deckMetaPillTextColor: '#111827',
	deckMetaPillBgColor: '#ffffff',
	deckMetaPillAccentColor: '#7c3aed',
	showHighlanderTotal: true,
	showHighlanderPointedCards: true,
	highlanderPointedCardsSize: 'medium',
	highlanderPointedCardsTextColor: '#111827',
	highlanderPointedCardsBgColor: '#ffffff',
	highlanderPointedCardsAccentColor: '#7c3aed',
	highlanderPointedCardsBorderColor: undefined,
	showHighlanderPoints: true,
	highlanderPointsPosition: 'top-left',
	highlanderPointsSize: 'medium',
	highlanderPointsTextColor: '#ffffff',
	highlanderPointsBgColor: '#7c3aed',
	quantityPosition: 'top-right',
	quantitySize: 'medium',
	quantityTextColor: '#ffffff',
	quantityBgColor: '#7c3aed',
};

export const DEFAULT_STANDINGS_CONFIG: StandingsModeConfig = {
	viewMode: 'all',
	columns: [
		{ key: 'position', visible: true },
		{ key: 'name', visible: true },
		{ key: 'record', visible: true },
		{ key: 'points', visible: true },
		{ key: 'deck', visible: false },
	],
	showArchetypeColors: false,
	maxTableWidth: undefined,
	roundId: undefined,
	showHeader: true,
	headerText: undefined,
	topNCount: 8,
	sliceStart: 1,
	sliceEnd: 16,
	playerListId: undefined,
	revealCount: 8,
	revealOrder: 'bottomUp',
	revealTrigger: 'manual',
	revealIntervalMs: 5000,
	revealedCount: 0,
	rowsPerPage: 8,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	animateEntries: true,
};

export const DEFAULT_TOPCUT_CONFIG: TopCutModeConfig = {
	bracketSize: 8,
};

export const DEFAULT_FEATURE_MATCH_CONFIG: FeatureMatchModeConfig = {
	featureMatchId: null,

	showNames: true,
	showRecords: true,
	showDeckNames: true,
	showPronouns: true,
	showClock: true,
	showCounters: true,
	showSeatLabels: true,
	showTurnControls: true,
	showOvertime: true,
	showMulliganInfo: true,
	showLgs: true,
	showTableNumber: true,
	leftSidePlayer: 'player1',
	allowLifeControls: true,
	allowGameWinControls: true,
	allowCounterControls: true,
};

export const DEFAULT_PLAYER_HISTORY_CONFIG: PlayerHistoryModeConfig = {
	playerId: null,
	columns: [
		{ key: 'round', visible: true },
		{ key: 'opponent', visible: true },
		{ key: 'table', visible: true },
		{ key: 'outcome', visible: true },
	],
	showHeader: true,
	headerText: undefined,
	rowsPerPage: 8,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
};

export const DEFAULT_BROADCAST_GRAPHICS_CONFIG: BroadcastGraphicsModeConfig = {
	graphics: [],
};

export const DEFAULT_METAGAME_CONFIG: MetagameModeConfig = {
	viewMode: 'archetype',
	scope: 'all',
	topN: 8,
	playerListId: undefined,
	archetypeFilter: undefined,
	sortBy: 'metaShare',
	cardSortBy: 'inclusionRate',
	archetypeColumns: [
		{ key: 'archetype', visible: true },
		{ key: 'count', visible: true },
		{ key: 'metaShare', visible: true },
		{ key: 'winRate', visible: true },
		{ key: 'avgPlace', visible: false },
		{ key: 'colors', visible: false },
	],
	cardColumns: [
		{ key: 'card', visible: true },
		{ key: 'manaCost', visible: true },
		{ key: 'type', visible: true },
		{ key: 'inclusionRate', visible: true },
		{ key: 'avgCopies', visible: true },
		{ key: 'totalCopies', visible: true },
		{ key: 'deckCount', visible: true },
		{ key: 'mainboardCount', visible: true },
		{ key: 'sideboardCount', visible: true },
	],
	limit: 50,
	maxTableWidth: undefined,
	pageSize: 10,
	autoPageEnabled: false,
	autoPageIntervalMs: 10000,
	showHeader: true,
	headerText: undefined,
	animateEntries: true,
};

export const DEFAULT_TOP_CARDS_CONFIG: TopCardsModeConfig = {
	scope: 'all',
	topN: 8,
	playerListId: undefined,
	archetypeFilter: undefined,
	board: 'mainboard',
	sortBy: 'inclusionRate',
	limit: 10,
	// Nonbasic lands read as noise in a "most played" ranking; basics never
	// reach the breakdown at all.
	excludedCardTypes: ['Land'],
	columns: 5,
	cardSize: 'medium',
	dynamicCardSize: true,
	cardGap: 12,
	showHeader: true,
	headerText: undefined,
	showCardNames: true,
	showRankBadges: true,
	rankBadgeTextColor: '#ffffff',
	rankBadgeBgColor: '#7c3aed',
	statBadge: 'inclusionRate',
	statBadgeSize: 'medium',
	statBadgeTextColor: '#111827',
	statBadgeBgColor: '#ffffff',
};

// Canonical default config map for all screen modes.
export const DEFAULT_MODE_CONFIGS = {
	'background': DEFAULT_BACKGROUND_CONFIG,
	'card': DEFAULT_CARD_CONFIG,
	'deck': DEFAULT_DECK_CONFIG,
	'standings': DEFAULT_STANDINGS_CONFIG,
	'topCut': DEFAULT_TOPCUT_CONFIG,
	'feature-match': DEFAULT_FEATURE_MATCH_CONFIG,
	'feature-match-overlay': DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
	'broadcast-graphics': DEFAULT_BROADCAST_GRAPHICS_CONFIG,
	'metagame': DEFAULT_METAGAME_CONFIG,
	'top-cards': DEFAULT_TOP_CARDS_CONFIG,
	'player-history': DEFAULT_PLAYER_HISTORY_CONFIG,
} satisfies { [K in ScreenMode]: ScreenModeConfig };

// Map of mode to config type
export type ModeConfigTypeMap = typeof DEFAULT_MODE_CONFIGS;

// Type for the modeConfigs column - partial map keyed by mode
export type ModeConfigsMap = Partial<ModeConfigTypeMap>;

// ─── Nullable config types (for reset / clear-to-default operations) ───
// Sending `null` for a field means "delete this key from stored config".
export type NullableScreenConfig = { [K in keyof ScreenConfig]: ScreenConfig[K] | null };

/**
 * Keys a display reset must not touch. Two kinds qualify:
 *
 * - Data bindings, such as the selected Feature Match Slot or Player: resetting
 *   display settings should not unpick what the Screen is pointing at.
 * - Authored content with no recovery path, such as a Broadcast Graphics
 *   Screen's stack of Broadcast Graphics. Resetting a Feature Match Layout
 *   restores a Feature Match Overlay Preset — a non-empty design the author can
 *   keep editing — whereas resetting the Broadcast Graphics stack would empty
 *   it, and there is no undo. The two are not the same action.
 */
type ModeResetPreservedKeysMap = {
	[K in ScreenMode]: readonly (keyof ModeConfigTypeMap[K])[];
};

const MODE_RESET_PRESERVED_KEYS = {
	// The layer stack is authored content with no recovery path, like the
	// Broadcast Graphics stack: a display reset must not empty it.
	'background': ['layers'],
	'card': ['featureMatchId'],
	'deck': ['deckSource'],
	'topCut': [],
	'feature-match': ['featureMatchId'],
	'feature-match-overlay': ['featureMatchId'],
	'broadcast-graphics': ['graphics'],
	'standings': ['viewMode', 'topNCount', 'sliceStart', 'sliceEnd', 'playerListId', 'revealCount', 'roundId'],
	'metagame': ['viewMode', 'scope', 'topN', 'playerListId', 'archetypeFilter'],
	'top-cards': ['scope', 'topN', 'playerListId', 'archetypeFilter'],
	'player-history': ['playerId'],
} as const satisfies ModeResetPreservedKeysMap;

// Helper to get default config for a mode
export function getDefaultConfigForMode<T extends ScreenMode>(mode: T): ModeConfigTypeMap[T] {
	return DEFAULT_MODE_CONFIGS[mode];
}

/**
 * Returns the display-only defaults for a mode. Used by "Reset to Defaults", so
 * it omits every key a reset must preserve — data bindings such as
 * `featureMatchId`, and authored content such as a Broadcast Graphics Screen's
 * stack of Broadcast Graphics.
 */
export function getDisplayDefaultsForMode<T extends ScreenMode>(mode: T): Partial<ModeConfigTypeMap[T]> {
	const full = getDefaultConfigForMode(mode);
	const preservedKeys = MODE_RESET_PRESERVED_KEYS[mode];
	const display = { ...full } as Record<string, unknown>;
	for (const key of preservedKeys) {
		delete display[key as string];
	}
	return display as Partial<ModeConfigTypeMap[T]>;
}

/** Strip keys whose value is `null` — used after merge so `null` acts as "delete". */
export function stripNullConfigKeys<T extends Record<string, unknown>>(config: T): T {
	return Object.fromEntries(
		Object.entries(config).filter(([, value]) => value !== null),
	) as T;
}

export function mergeScreenConfig(currentConfig: ScreenConfig, partialConfig: Record<string, unknown>): ScreenConfig {
	return stripNullConfigKeys({ ...currentConfig, ...partialConfig }) as ScreenConfig;
}

export function mergeScreenModeConfig<M extends ScreenMode>(
	currentConfigs: ModeConfigsMap,
	mode: M,
	partialConfig: Record<string, unknown>,
): ModeConfigsMap {
	const currentModeConfig = currentConfigs[mode] ?? {};
	return {
		...currentConfigs,
		[mode]: stripNullConfigKeys({ ...currentModeConfig, ...partialConfig }),
	};
}
