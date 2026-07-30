import type { CardAnimationSpeed, DeckCardSize, DeckViewMode, HorizontalAlign, MetagameArchetypeColumnKey, MetagameCardColumnKey, MetagameCardSortBy, MetagameScope, MetagameSortBy, MetagameViewMode, PlayerHistoryColumnKey, PlayerSide, QuantityPosition, QuantitySize, RevealOrder, RevealTrigger, ScreenColorMode, ScreenMode, SideboardLayout, StandingsColumnKey, StandingsViewMode, VerticalAlign } from './enums';
import type { BroadcastGraphicConfig } from './graphics';
import type { GraphicAssetReference } from './graphicsAsset';

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
export type FeatureMatchLayoutItemType = 'source' | 'widget' | 'widget-group';
export type FeatureMatchSourceRole = 'main' | 'player1' | 'player2' | string;
export type FeatureMatchWidgetType = 'text' | 'image' | 'clock' | 'player-life' | 'game-wins';
export type FeatureMatchGameWinsDisplayMode = 'boxes' | 'number';
export type FeatureMatchGameWinsBoxOrientation = 'horizontal' | 'vertical';
export type FeatureMatchWidgetGroupArrangementMode = 'row' | 'column' | 'canvas';
export type FeatureMatchWidgetGroupAlign = 'start' | 'center' | 'end' | 'stretch';
export type FeatureMatchWidgetGroupJustify = 'start' | 'center' | 'end' | 'space-between';
export type FeatureMatchWidgetGroupOverflow = 'clip' | 'visible';
export type FeatureMatchWidgetGroupChildSizingMode = 'fixed' | 'content' | 'fill';

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

export type FeatureMatchOverlayFontSelection
	= {
		kind: 'application';
		fontId: string;
	}
	| {
		kind: 'asset';
		reference: GraphicAssetReference;
	};

export interface FeatureMatchOverlayBoxStyle extends FeatureMatchOverlayBorderSides {
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
	padding?: number;
	textColor?: string;
	fontSize?: number;
	font?: FeatureMatchOverlayFontSelection;
	fontWeight?: number | string;
	fontStyle?: 'normal' | 'italic';
	textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
	letterSpacing?: number;
	lineHeight?: number;
	textAlign?: 'left' | 'center' | 'right';
	overflow?: 'clip' | 'ellipsis' | 'shrink' | 'visible';
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

export interface FeatureMatchLayoutItemBase extends FeatureMatchOverlayRect {
	id: string;
	label: string;
	visible: boolean;
	anchor?: FeatureMatchOverlayAnchorValue;
	zIndex?: number;
	surfaceStyle?: FeatureMatchOverlayBoxStyle;
}

export interface FeatureMatchSourceItemConfig extends FeatureMatchLayoutItemBase {
	type: 'source';
	sourceRole?: FeatureMatchSourceRole;
	frameCutout: boolean;
}

export interface FeatureMatchTextWidgetConfig {
	type: 'text';
	template: string;
	playerSide?: PlayerSide;
	spacerWidth?: number;
	tokenStyles?: FeatureMatchOverlayTokenStyleMap;
}

export interface FeatureMatchImageWidgetConfig {
	type: 'image';
	asset?: GraphicAssetReference;
	fit: 'contain' | 'cover' | 'fill';
	opacity: number;
	borderRadius: number;
}

export interface FeatureMatchClockWidgetConfig {
	type: 'clock';
}

export interface FeatureMatchPlayerLifeWidgetConfig {
	type: 'player-life';
	playerSide: PlayerSide;
	lifeAnimation?: FeatureMatchOverlayPlayerLifeAnimation;
	lifeAnimationDurationMs?: number;
	lifeAnimationAccentColor?: string;
}

export interface FeatureMatchGameWinsWidgetConfig {
	type: 'game-wins';
	playerSide: PlayerSide;
	displayMode?: FeatureMatchGameWinsDisplayMode;
	boxOrientation?: FeatureMatchGameWinsBoxOrientation;
	boxWidth?: number;
	boxHeight?: number;
	boxGap?: number;
	boxBorderWidth?: number;
}

export type FeatureMatchWidgetConfig
	=	| FeatureMatchTextWidgetConfig
		| FeatureMatchImageWidgetConfig
		| FeatureMatchClockWidgetConfig
		| FeatureMatchPlayerLifeWidgetConfig
		| FeatureMatchGameWinsWidgetConfig;

export interface FeatureMatchWidgetItemConfig extends FeatureMatchLayoutItemBase {
	type: 'widget';
	widget: FeatureMatchWidgetConfig;
}

export interface FeatureMatchWidgetGroupArrangementBase {
	mode: FeatureMatchWidgetGroupArrangementMode;
	padding?: number;
}

export interface FeatureMatchWidgetGroupStackArrangement extends FeatureMatchWidgetGroupArrangementBase {
	mode: 'row' | 'column';
	gap: number;
	align: FeatureMatchWidgetGroupAlign;
	justify: FeatureMatchWidgetGroupJustify;
}

export interface FeatureMatchWidgetGroupCanvasArrangement extends FeatureMatchWidgetGroupArrangementBase {
	mode: 'canvas';
}

export type FeatureMatchWidgetGroupArrangement
	=	| FeatureMatchWidgetGroupStackArrangement
		| FeatureMatchWidgetGroupCanvasArrangement;

export interface FeatureMatchWidgetGroupChildSizing {
	mode: FeatureMatchWidgetGroupChildSizingMode;
	size?: number;
	weight?: number;
	min?: number;
	max?: number;
}

export interface FeatureMatchWidgetGroupStackChildLayout {
	mode: 'stack';
	sizing: FeatureMatchWidgetGroupChildSizing;
	offsetX?: number;
	offsetY?: number;
	alignSelf?: FeatureMatchWidgetGroupAlign;
}

export interface FeatureMatchWidgetGroupCanvasChildLayout extends FeatureMatchOverlayRect {
	mode: 'canvas';
	anchor?: FeatureMatchOverlayAnchorValue;
	zIndex?: number;
}

export type FeatureMatchWidgetGroupChildLayout
	=	| FeatureMatchWidgetGroupStackChildLayout
		| FeatureMatchWidgetGroupCanvasChildLayout;

export interface FeatureMatchWidgetGroupChildConfig {
	id: string;
	label: string;
	visible: boolean;
	widget: FeatureMatchWidgetConfig;
	layout: FeatureMatchWidgetGroupChildLayout;
	surfaceStyle?: FeatureMatchOverlayBoxStyle;
}

export interface FeatureMatchWidgetGroupItemConfig extends FeatureMatchLayoutItemBase {
	type: 'widget-group';
	arrangement: FeatureMatchWidgetGroupArrangement;
	defaultChildSurfaceStyle?: FeatureMatchOverlayBoxStyle;
	overflow?: FeatureMatchWidgetGroupOverflow;
	children: FeatureMatchWidgetGroupChildConfig[];
}

export type FeatureMatchLayoutItemConfig
	=	| FeatureMatchSourceItemConfig
		| FeatureMatchWidgetItemConfig
		| FeatureMatchWidgetGroupItemConfig;

export interface FeatureMatchLayoutConfig {
	frame: FeatureMatchLayoutFrameConfig;
	items: FeatureMatchLayoutItemConfig[];
}

export type FeatureMatchOverlayTokenStyleMap = Record<string, FeatureMatchOverlayBoxStyle | undefined>;

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
		items: [
			{ id: 'main-source', type: 'source', label: 'Main Match Source', visible: true, sourceRole: 'main', frameCutout: true, x: 400, y: 90, width: 1500, height: 900, zIndex: 10, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
			{ id: 'player1-source', type: 'source', label: 'Player 1 Source', visible: true, sourceRole: 'player1', frameCutout: true, x: 24, y: 16, width: 340, height: 250, zIndex: 10, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
			{ id: 'player2-source', type: 'source', label: 'Player 2 Source', visible: true, sourceRole: 'player2', frameCutout: true, x: 24, y: 800, width: 340, height: 250, zIndex: 10, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
			{ id: 'top-bar', type: 'widget-group', label: 'Top Player Bar', visible: true, x: 400, y: 8, width: 1500, height: 74, zIndex: 30, surfaceStyle: { backgroundOpacity: 0 }, defaultChildSurfaceStyle: { textColor: '#ffffff', fontSize: 30, fontWeight: 800, backgroundOpacity: 0, overflow: 'ellipsis' }, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [
				{ id: 'top-name-record', label: 'Name and Record', visible: true, widget: { type: 'text', playerSide: 'player1', template: '{name}\n{record}' }, layout: { mode: 'canvas', x: 0, y: 0, width: 300, height: 74 } },
				{ id: 'top-life', label: 'Life Total', visible: true, widget: { type: 'player-life', playerSide: 'player1', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }, layout: { mode: 'canvas', x: 700, y: 4, width: 96, height: 66 }, surfaceStyle: { backgroundColor: '#333333', backgroundOpacity: 1, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8, textColor: '#ffffff', fontSize: 42, fontWeight: 800, textAlign: 'center' } },
				{ id: 'top-deck', label: 'Deck', visible: true, widget: { type: 'text', playerSide: 'player1', template: '{deckColors} {deck}' }, layout: { mode: 'canvas', x: 820, y: 0, width: 500, height: 74 } },
				{ id: 'top-clock', label: 'Clock', visible: true, widget: { type: 'clock' }, layout: { mode: 'canvas', x: 1360, y: 0, width: 140, height: 74 }, surfaceStyle: { fontSize: 28, fontWeight: 500, textAlign: 'right' } },
			] },
			{ id: 'bottom-bar', type: 'widget-group', label: 'Bottom Player Bar', visible: true, x: 400, y: 1000, width: 1500, height: 74, zIndex: 30, surfaceStyle: { backgroundOpacity: 0 }, defaultChildSurfaceStyle: { textColor: '#ffffff', fontSize: 30, fontWeight: 800, backgroundOpacity: 0, overflow: 'ellipsis' }, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [
				{ id: 'bottom-name-record', label: 'Name and Record', visible: true, widget: { type: 'text', playerSide: 'player2', template: '{name}\n{record}' }, layout: { mode: 'canvas', x: 0, y: 0, width: 300, height: 74 } },
				{ id: 'bottom-life', label: 'Life Total', visible: true, widget: { type: 'player-life', playerSide: 'player2', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }, layout: { mode: 'canvas', x: 700, y: 4, width: 96, height: 66 }, surfaceStyle: { backgroundColor: '#333333', backgroundOpacity: 1, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8, textColor: '#ffffff', fontSize: 42, fontWeight: 800, textAlign: 'center' } },
				{ id: 'bottom-deck', label: 'Deck', visible: true, widget: { type: 'text', playerSide: 'player2', template: '{deckColors} {deck}' }, layout: { mode: 'canvas', x: 820, y: 0, width: 500, height: 74 } },
				{ id: 'bottom-details', label: 'Match Details', visible: true, widget: { type: 'text', playerSide: 'player2', template: '{stage}\n{format}' }, layout: { mode: 'canvas', x: 1320, y: 0, width: 180, height: 74 }, surfaceStyle: { fontSize: 28, fontWeight: 700, textAlign: 'right' } },
			] },
			{ id: 'player1-game-wins', type: 'widget', label: 'Player 1 Game Wins', visible: true, x: 24, y: 278, width: 340, height: 28, zIndex: 30, widget: { type: 'game-wins', playerSide: 'player1', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 6, boxBorderWidth: 2 }, surfaceStyle: { backgroundColor: '#22c55e', backgroundOpacity: 0, borderVisible: true, borderColor: '#ffffff', borderWidth: 2, borderRadius: 999 } },
			{ id: 'player2-game-wins', type: 'widget', label: 'Player 2 Game Wins', visible: true, x: 24, y: 760, width: 340, height: 28, zIndex: 30, widget: { type: 'game-wins', playerSide: 'player2', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 6, boxBorderWidth: 2 }, surfaceStyle: { backgroundColor: '#22c55e', backgroundOpacity: 0, borderVisible: true, borderColor: '#ffffff', borderWidth: 2, borderRadius: 999 } },
			{ id: 'branding', type: 'widget-group', label: 'Event Branding', visible: true, x: 60, y: 360, width: 280, height: 280, zIndex: 30, surfaceStyle: { backgroundOpacity: 0 }, defaultChildSurfaceStyle: { textColor: '#ffffff', fontSize: 24, fontWeight: 700, backgroundOpacity: 0, textAlign: 'center' }, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [
				{ id: 'branding-text', label: 'Event Name', visible: true, widget: { type: 'text', template: '{eventName}' }, layout: { mode: 'canvas', x: 0, y: 0, width: 280, height: 80 } },
				{ id: 'branding-image-1', label: 'Image 1', visible: true, widget: { type: 'image', fit: 'contain', opacity: 1, borderRadius: 0 }, layout: { mode: 'canvas', x: 0, y: 96, width: 132, height: 132 } },
				{ id: 'branding-image-2', label: 'Image 2', visible: true, widget: { type: 'image', fit: 'contain', opacity: 1, borderRadius: 0 }, layout: { mode: 'canvas', x: 148, y: 96, width: 132, height: 132 } },
			] },
		],
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

// Keys that are data bindings (not display settings) — excluded from display resets
type ModeDataBindingKeysMap = {
	[K in ScreenMode]: readonly (keyof ModeConfigTypeMap[K])[];
};

const MODE_DATA_BINDING_KEYS = {
	'idle': [],
	'card': ['featureMatchId'],
	'deck': ['playerId'],
	'topCut': [],
	'feature-match': ['featureMatchId'],
	'feature-match-overlay': ['featureMatchId'],
	'broadcast-graphics': [],
	'standings': ['viewMode', 'topNCount', 'sliceStart', 'sliceEnd', 'playerListId', 'revealCount', 'roundId'],
	'metagame': ['viewMode', 'scope', 'topN', 'playerListId', 'archetypeFilter'],
	'player-history': ['playerId'],
} as const satisfies ModeDataBindingKeysMap;

// Helper to get default config for a mode
export function getDefaultConfigForMode<T extends ScreenMode>(mode: T): ModeConfigTypeMap[T] {
	return DEFAULT_MODE_CONFIGS[mode];
}

/**
 * Returns the display-only defaults for a mode (excludes data bindings like featureMatchId, playerId).
 * Used by the "Reset to Defaults" feature so data bindings are preserved.
 */
export function getDisplayDefaultsForMode<T extends ScreenMode>(mode: T): Partial<ModeConfigTypeMap[T]> {
	const full = getDefaultConfigForMode(mode);
	const bindingKeys = MODE_DATA_BINDING_KEYS[mode];
	const display = { ...full } as Record<string, unknown>;
	for (const key of bindingKeys) {
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
