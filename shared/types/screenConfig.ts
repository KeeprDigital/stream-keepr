import type { CardAnimationSpeed, DeckCardSize, DeckViewMode, HorizontalAlign, MetagameArchetypeColumnKey, MetagameCardColumnKey, MetagameCardSortBy, MetagameScope, MetagameSortBy, MetagameViewMode, PlayerHistoryColumnKey, PlayerSide, QuantityPosition, QuantitySize, RevealOrder, RevealTrigger, ScreenColorMode, ScreenMode, SideboardLayout, StandingsColumnKey, StandingsViewMode, VerticalAlign } from './enums';
import type { BroadcastGraphicConfig } from './graphics';
import type { GraphicAssetReference } from './graphicsAsset';
import {
	FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
	FEATURE_MATCH_LAYOUT_COMPOSITION_NAME,
} from '../featureMatchLayoutComposition';
import {
	clockItem,
	gameWinsItem,
	groupItem,
	mediaItem,
	playerLifeItem,
	shapeItem,
	solidFill,
	surfaceStyle,
	textItem,
	typography,
} from '../featureMatchLayoutItems';
import { roundedShapeGeometry } from '../modules/graphics/shapeGeometry';

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
export interface DeckModeConfig {
	playerId: number | null;
	viewMode: DeckViewMode;
	columns?: number;
	listColumns?: number;
	cardSize?: DeckCardSize;
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

	// Card sizing
	dynamicCardSize?: boolean;
	cardGap?: number;

	// Sideboard options
	showMainboard?: boolean;
	showSideboard?: boolean;
	sideboardLayout?: SideboardLayout;

	// Stack layout settings
	stackOverlap?: number;
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

	// Pagination
	rowsPerPage: number;
	autoPageEnabled: boolean;
	autoPageIntervalMs: number;
	currentPage?: number;

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
export type FeatureMatchSourceRole = 'main' | 'player1' | 'player2' | string;

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
 */
export interface FeatureMatchSourceSurfaceStyle extends FeatureMatchOverlayBorderSides {
	backgroundColor?: string;
	backgroundOpacity?: number;
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

export type FeatureMatchOverlayFrameAnimationEffect = 'cells' | 'dots' | 'fog' | 'globe' | 'halo' | 'net' | 'rings' | 'ripple' | 'waves';
export type FeatureMatchOverlayPlayerLifeAnimation = 'none' | 'fade' | 'pop' | 'slide' | 'glow';

export interface FeatureMatchOverlayFrameAnimationConfig {
	enabled: boolean;
	effect: FeatureMatchOverlayFrameAnimationEffect;
	opacity: number;
	// Animation color options
	highlightColor?: string;
	midtoneColor?: string;
	lowlightColor?: string;
	baseColor?: string;
	color1?: string;
	color2?: string;
	backgroundColor?: string;
	// Animation numeric shader / effect options
	blurFactor?: number;
	speed?: number;
	zoom?: number;
	amplitudeFactor?: number;
	ringFactor?: number;
	rotationFactor?: number;
	xOffset?: number;
	yOffset?: number;
	// Animation wave / graph options
	color?: string;
	shininess?: number;
	waveHeight?: number;
	waveSpeed?: number;
	points?: number;
	maxDistance?: number;
	spacing?: number;
	showDots?: boolean;
	size?: number;
	showLines?: boolean;
	// Stream Keepr synthetic movement options
	mouseDriftEnabled: boolean;
	mouseDriftMode?: 'orbit' | 'random';
	mouseDriftSeconds: number;
	mouseDriftRadius: number;
}

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
	surfaceStyle?: FeatureMatchSourceSurfaceStyle;
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
 * Graphics; concurrent graphics always render in this order. The Screen's one
 * configurable pixel canvas remains the Screen's own width and height, and
 * playout, channels, inputs, and animation are live state rather than authored
 * configuration.
 */
export interface BroadcastGraphicsModeConfig {
	graphics: BroadcastGraphicConfig[];
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
	autoPaging: boolean;
	autoPageIntervalMs: number;
	currentPage?: number;

	// Visibility toggles
	showHeader: boolean;
	headerText?: string;

	// Animation
	animateEntries: boolean;
}

// Union type for all mode configs
export type ScreenModeConfig = DeckModeConfig | CardModeConfig | IdleModeConfig | StandingsModeConfig | TopCutModeConfig | FeatureMatchModeConfig | FeatureMatchOverlayModeConfig | BroadcastGraphicsModeConfig | MetagameModeConfig | PlayerHistoryModeConfig;

// Default configs for each mode
export const DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG: ScreenMediaBackgroundConfig = {
	enabled: false,
	type: 'video',
	url: '',
	fit: 'cover',
	opacity: 1,
	playbackRate: 1,
	loop: true,
};

export interface IdleModeConfig {
	mediaBackground?: ScreenMediaBackgroundConfig;
}

export const DEFAULT_IDLE_CONFIG: IdleModeConfig = {
	mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG },
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

export const DEFAULT_DECK_CONFIG: DeckModeConfig = {
	playerId: null,
	viewMode: 'grid',
	cardSize: 'medium',
	columns: 4,
	listColumns: 2,
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
	dynamicCardSize: false,
	cardGap: 8,
	showMainboard: true,
	showSideboard: true,
	sideboardLayout: 'stack',
	stackOverlap: 15,
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

export const DEFAULT_FRAME_ANIMATION: FeatureMatchOverlayFrameAnimationConfig = {
	enabled: false,
	effect: 'fog',
	opacity: 0.45,
	highlightColor: '#f59e0b',
	midtoneColor: '#7c3aed',
	lowlightColor: '#06b6d4',
	baseColor: '#111111',
	blurFactor: 0.55,
	speed: 0.6,
	zoom: 1,
	color: '#7c3aed',
	color2: '#06b6d4',
	backgroundColor: '#111111',
	shininess: 30,
	waveHeight: 20,
	waveSpeed: 1,
	points: 10,
	maxDistance: 22,
	spacing: 16,
	showDots: true,
	size: 3,
	showLines: true,
	mouseDriftEnabled: true,
	mouseDriftMode: 'orbit',
	mouseDriftSeconds: 18,
	mouseDriftRadius: 0.28,
};

/** The Player Life pill's typography, identical on both sides of a Player Bar. */
function playerBarLifeTypography() {
	return typography({ fontSize: 42, fontWeight: 800, textAlign: 'center' });
}

/** A Player Bar's own text: white, heavy, and clipped to the bar with an ellipsis. */
function playerBarTypography(overrides: Parameters<typeof typography>[0] = {}) {
	return typography({ fontSize: 30, fontWeight: 800, ...overrides });
}

/**
 * A rounded pill behind a Player Life total.
 *
 * Two Graphic Items rather than one, because a Graphic Surface Style carries no
 * Shape Geometry: corners belong to a Shape Graphic Item, so a rounded bed is
 * composed behind the Item that reads the life total. This is the same
 * composition the dropped per-side borders use, applied to corners.
 */
function playerLifePill(side: PlayerSide, prefix: string, rect: { x: number; y: number; width: number; height: number }) {
	return [
		shapeItem({
			id: `${prefix}-life-bed`,
			label: 'Life Total Bed',
			...rect,
			geometry: roundedShapeGeometry(8),
			surfaceStyle: surfaceStyle(solidFill('#333333'), { outline: { color: '#0077a3', width: 4 } }),
		}),
		playerLifeItem({
			id: `${prefix}-life`,
			label: 'Life Total',
			...rect,
			playerSide: side,
			typography: playerBarLifeTypography(),
		}),
	];
}

/**
 * The default Feature Match Layout, which is also the `left-stacked-player-cams`
 * Feature Match Overlay Preset.
 *
 * The Frame and the Source Items are host-owned; everything else is an authored
 * composition in the Shared Graphics Foundation vocabulary, which is what the
 * capability-parity checklist verifies.
 */
export const DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG: FeatureMatchOverlayModeConfig = {
	featureMatchId: null,
	presetId: 'left-stacked-player-cams',
	layout: {
		frame: {
			backgroundColor: '#111111',
			opacity: 0.92,
			backgroundImageFit: 'cover',
			mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG },
			animation: { ...DEFAULT_FRAME_ANIMATION },
			borderVisible: true,
			borderColor: '#0077a3',
			borderWidth: 4,
		},
		sources: [
			{ id: 'main-source', label: 'Main Match Source', visible: true, sourceRole: 'main', frameCutout: true, x: 400, y: 90, width: 1500, height: 900, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
			{ id: 'player1-source', label: 'Player 1 Source', visible: true, sourceRole: 'player1', frameCutout: true, x: 24, y: 16, width: 340, height: 250, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
			{ id: 'player2-source', label: 'Player 2 Source', visible: true, sourceRole: 'player2', frameCutout: true, x: 24, y: 800, width: 340, height: 250, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
		],
		composition: {
			id: FEATURE_MATCH_LAYOUT_COMPOSITION_ID,
			name: FEATURE_MATCH_LAYOUT_COMPOSITION_NAME,
			items: [
				groupItem({
					id: 'top-bar',
					label: 'Top Player Bar',
					x: 400,
					y: 8,
					width: 1500,
					height: 74,
					children: [
						textItem({ id: 'top-name-record', label: 'Name and Record', x: 0, y: 0, width: 300, height: 74, text: '{player1Name}\n{player1Record}', typography: playerBarTypography() }),
						...playerLifePill('player1', 'top', { x: 700, y: 4, width: 96, height: 66 }),
						textItem({ id: 'top-deck', label: 'Deck', x: 820, y: 0, width: 500, height: 74, text: '{player1DeckColors} {player1Deck}', typography: playerBarTypography() }),
						clockItem({ id: 'top-clock', label: 'Clock', x: 1360, y: 0, width: 140, height: 74, typography: playerBarTypography({ fontSize: 28, fontWeight: 500, textAlign: 'right' }) }),
					],
				}),
				groupItem({
					id: 'bottom-bar',
					label: 'Bottom Player Bar',
					x: 400,
					y: 1000,
					width: 1500,
					height: 74,
					children: [
						textItem({ id: 'bottom-name-record', label: 'Name and Record', x: 0, y: 0, width: 300, height: 74, text: '{player2Name}\n{player2Record}', typography: playerBarTypography() }),
						...playerLifePill('player2', 'bottom', { x: 700, y: 4, width: 96, height: 66 }),
						textItem({ id: 'bottom-deck', label: 'Deck', x: 820, y: 0, width: 500, height: 74, text: '{player2DeckColors} {player2Deck}', typography: playerBarTypography() }),
						textItem({ id: 'bottom-details', label: 'Match Details', x: 1320, y: 0, width: 180, height: 74, text: '{stage}\n{format}', typography: playerBarTypography({ fontSize: 28, fontWeight: 700, textAlign: 'right' }) }),
					],
				}),
				gameWinsItem({ id: 'player1-game-wins', label: 'Player 1 Game Wins', x: 24, y: 278, width: 340, height: 28, playerSide: 'player1', boxWidth: 22, boxHeight: 22, boxGap: 6, boxRadius: 11, outlineWidth: 2, outlineColor: '#ffffff', wonColor: '#22c55e' }),
				gameWinsItem({ id: 'player2-game-wins', label: 'Player 2 Game Wins', x: 24, y: 760, width: 340, height: 28, playerSide: 'player2', boxWidth: 22, boxHeight: 22, boxGap: 6, boxRadius: 11, outlineWidth: 2, outlineColor: '#ffffff', wonColor: '#22c55e' }),
				groupItem({
					id: 'branding',
					label: 'Event Branding',
					x: 60,
					y: 360,
					width: 280,
					height: 280,
					children: [
						textItem({ id: 'branding-text', label: 'Event Name', x: 0, y: 0, width: 280, height: 80, text: '{eventName}', typography: typography({ fontSize: 24, fontWeight: 700, textAlign: 'center' }) }),
						mediaItem({ id: 'branding-image-1', label: 'Image 1', x: 0, y: 96, width: 132, height: 132 }),
						mediaItem({ id: 'branding-image-2', label: 'Image 2', x: 148, y: 96, width: 132, height: 132 }),
					],
				}),
			],
		},
	},
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
	autoPaging: false,
	autoPageIntervalMs: 10000,
	showHeader: true,
	headerText: undefined,
	animateEntries: true,
};

// Canonical default config map for all screen modes.
export const DEFAULT_MODE_CONFIGS = {
	'idle': DEFAULT_IDLE_CONFIG,
	'card': DEFAULT_CARD_CONFIG,
	'deck': DEFAULT_DECK_CONFIG,
	'standings': DEFAULT_STANDINGS_CONFIG,
	'topCut': DEFAULT_TOPCUT_CONFIG,
	'feature-match': DEFAULT_FEATURE_MATCH_CONFIG,
	'feature-match-overlay': DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG,
	'broadcast-graphics': DEFAULT_BROADCAST_GRAPHICS_CONFIG,
	'metagame': DEFAULT_METAGAME_CONFIG,
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
	'idle': [],
	'card': ['featureMatchId'],
	'deck': ['playerId'],
	'topCut': [],
	'feature-match': ['featureMatchId'],
	'feature-match-overlay': ['featureMatchId'],
	'broadcast-graphics': ['graphics'],
	'standings': ['viewMode', 'topNCount', 'sliceStart', 'sliceEnd', 'playerListId', 'revealCount', 'roundId'],
	'metagame': ['viewMode', 'scope', 'topN', 'playerListId', 'archetypeFilter'],
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
