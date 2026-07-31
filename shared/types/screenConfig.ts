import type { GraphicsVideoTarget } from '../utils/graphicAssetTargetCompatibility';
import type { CardAnimationSpeed, DeckCardSize, DeckViewMode, HorizontalAlign, MetagameArchetypeColumnKey, MetagameCardColumnKey, MetagameCardSortBy, MetagameScope, MetagameSortBy, MetagameViewMode, PlayerHistoryColumnKey, PlayerSide, QuantityPosition, QuantitySize, RevealOrder, RevealTrigger, ScreenColorMode, ScreenMode, SideboardLayout, StandingsColumnKey, StandingsViewMode, VerticalAlign } from './enums';
import type { FeatureMatchMediaPresentationConfig } from './graphicItem';
import type { BroadcastGraphicConfig } from './graphics';
import type { GraphicAssetReference } from './graphicsAsset';
import { migrateFeatureMatchGraphicItemConfig } from '../featureMatchGraphicItemDefinitions';

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
export type FeatureMatchLayoutItemType = 'source' | 'media' | 'graphic-item' | 'graphic-group';
export type FeatureMatchSourceRole = 'main' | 'player1' | 'player2' | string;
export type FeatureMatchGameWinsDisplayMode = 'boxes' | 'number';
export type FeatureMatchGameWinsBoxOrientation = 'horizontal' | 'vertical';
export type FeatureMatchGraphicGroupArrangementMode = 'row' | 'column' | 'canvas';
export type FeatureMatchGraphicGroupAlign = 'start' | 'center' | 'end' | 'stretch';
export type FeatureMatchGraphicGroupJustify = 'start' | 'center' | 'end' | 'space-between';
export type FeatureMatchGraphicGroupOverflow = 'clip' | 'visible';
export type FeatureMatchGraphicGroupChildSizingMode = 'fixed' | 'content' | 'fill';

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
}

export interface FeatureMatchSourceItemContentConfig {
	type: 'source';
	configurationVersion?: number;
	sourceRole?: FeatureMatchSourceRole;
	frameCutout: boolean;
	surfaceStyle?: FeatureMatchOverlayBoxStyle;
}

export interface FeatureMatchSourceItemConfig extends FeatureMatchLayoutItemBase, FeatureMatchSourceItemContentConfig {}

export interface FeatureMatchTextGraphicItemConfig {
	type: 'text';
	configurationVersion?: number;
	template: string;
	playerSide?: PlayerSide;
	spacerWidth?: number;
	tokenStyles?: FeatureMatchOverlayTokenStyleMap;
}

export interface FeatureMatchClockGraphicItemConfig {
	type: 'clock';
	configurationVersion?: number;
}

export interface FeatureMatchPlayerLifeGraphicItemConfig {
	type: 'player-life';
	configurationVersion?: number;
	playerSide: PlayerSide;
	lifeAnimation?: FeatureMatchOverlayPlayerLifeAnimation;
	lifeAnimationDurationMs?: number;
	lifeAnimationAccentColor?: string;
}

export interface FeatureMatchGameWinsGraphicItemConfig {
	type: 'game-wins';
	configurationVersion?: number;
	playerSide: PlayerSide;
	displayMode?: FeatureMatchGameWinsDisplayMode;
	boxOrientation?: FeatureMatchGameWinsBoxOrientation;
	boxWidth?: number;
	boxHeight?: number;
	boxGap?: number;
	boxBorderWidth?: number;
}

export type FeatureMatchGraphicItemDefinitionConfig
	=	| FeatureMatchTextGraphicItemConfig
		| FeatureMatchClockGraphicItemConfig
		| FeatureMatchPlayerLifeGraphicItemConfig
		| FeatureMatchGameWinsGraphicItemConfig;

export type FeatureMatchGraphicGroupGraphicItemDefinitionConfig
	= FeatureMatchGraphicItemDefinitionConfig;

export interface FeatureMatchSpecificGraphicItemConfig extends FeatureMatchLayoutItemBase {
	type: 'graphic-item';
	graphicItem: FeatureMatchGraphicItemDefinitionConfig;
	surfaceStyle?: FeatureMatchOverlayBoxStyle;
}

/**
 * Feature Match context placement facts composed with Feature Match Overlay's
 * own media presentation contract. Top-level items and Graphic Group children
 * use this exact same content seam.
 */
export interface FeatureMatchMediaGraphicItemContentConfig extends FeatureMatchMediaPresentationConfig {
	type: 'media';
	configurationVersion?: number;
	videoCompatibility?: 'all-supported' | 'chromium-transparency';
	videoTarget?: Exclude<GraphicsVideoTarget, 'other'>;
}

/** First-class still-image or silent-video content in a Feature Match Layout. */
export interface FeatureMatchMediaGraphicItemConfig extends FeatureMatchLayoutItemBase, FeatureMatchMediaGraphicItemContentConfig {}

export interface FeatureMatchGraphicGroupArrangementBase {
	mode: FeatureMatchGraphicGroupArrangementMode;
	padding?: number;
}

export interface FeatureMatchGraphicGroupStackArrangement extends FeatureMatchGraphicGroupArrangementBase {
	mode: 'row' | 'column';
	gap: number;
	align: FeatureMatchGraphicGroupAlign;
	justify: FeatureMatchGraphicGroupJustify;
}

export interface FeatureMatchGraphicGroupCanvasArrangement extends FeatureMatchGraphicGroupArrangementBase {
	mode: 'canvas';
}

export type FeatureMatchGraphicGroupArrangement
	=	| FeatureMatchGraphicGroupStackArrangement
		| FeatureMatchGraphicGroupCanvasArrangement;

export interface FeatureMatchGraphicGroupChildSizing {
	mode: FeatureMatchGraphicGroupChildSizingMode;
	size?: number;
	weight?: number;
	min?: number;
	max?: number;
}

export interface FeatureMatchGraphicGroupStackChildLayout {
	mode: 'stack';
	sizing: FeatureMatchGraphicGroupChildSizing;
	offsetX?: number;
	offsetY?: number;
	alignSelf?: FeatureMatchGraphicGroupAlign;
}

export interface FeatureMatchGraphicGroupCanvasChildLayout extends FeatureMatchOverlayRect {
	mode: 'canvas';
	anchor?: FeatureMatchOverlayAnchorValue;
}

export type FeatureMatchGraphicGroupChildLayout
	=	| FeatureMatchGraphicGroupStackChildLayout
		| FeatureMatchGraphicGroupCanvasChildLayout;

export interface FeatureMatchGraphicGroupChildBaseConfig {
	id: string;
	label: string;
	visible: boolean;
	layout: FeatureMatchGraphicGroupChildLayout;
}

export interface FeatureMatchGraphicGroupGraphicItemChildContentConfig {
	type: 'graphic-item';
	graphicItem: FeatureMatchGraphicGroupGraphicItemDefinitionConfig;
	surfaceStyle?: FeatureMatchOverlayBoxStyle;
}

export type FeatureMatchGraphicGroupChildContentConfig
	=	| FeatureMatchGraphicGroupGraphicItemChildContentConfig
		| FeatureMatchMediaGraphicItemContentConfig;

export type FeatureMatchGraphicGroupChildConfig
	= FeatureMatchGraphicGroupChildBaseConfig & FeatureMatchGraphicGroupChildContentConfig;

export type FeatureMatchGraphicGroupGraphicItemChildConfig
	= FeatureMatchGraphicGroupChildBaseConfig & FeatureMatchGraphicGroupGraphicItemChildContentConfig;

export type FeatureMatchGraphicGroupMediaChildConfig
	= FeatureMatchGraphicGroupChildBaseConfig & FeatureMatchMediaGraphicItemContentConfig;

export interface FeatureMatchGraphicGroupContentConfig {
	type: 'graphic-group';
	configurationVersion?: number;
	surfaceStyle?: FeatureMatchOverlayBoxStyle;
	arrangement: FeatureMatchGraphicGroupArrangement;
	defaultChildSurfaceStyle?: FeatureMatchOverlayBoxStyle;
	overflow?: FeatureMatchGraphicGroupOverflow;
	children: FeatureMatchGraphicGroupChildConfig[];
}

export interface FeatureMatchGraphicGroupItemConfig extends FeatureMatchLayoutItemBase, FeatureMatchGraphicGroupContentConfig {}

export type FeatureMatchGraphicItemDefinitionOwnedConfig
	=	| FeatureMatchSourceItemContentConfig
		| FeatureMatchGraphicItemDefinitionConfig
		| FeatureMatchMediaGraphicItemContentConfig
		| FeatureMatchGraphicGroupContentConfig;

export type FeatureMatchLayoutItemConfig
	=	| FeatureMatchSourceItemConfig
		| FeatureMatchMediaGraphicItemConfig
		| FeatureMatchSpecificGraphicItemConfig
		| FeatureMatchGraphicGroupItemConfig;

/**
 * The authored arrangement a Feature Match Overlay renders.
 *
 * It carries three things, and they are three rather than one because the Host
 * Contract draws the line between them:
 *
 * - `frame` is the Feature Match Overlay Frame: the continuous graphic area
 *   behind and around everything else. It stays host-owned — backgrounds, media,
 *   shader animation effects, per-side border, and glow are capability outside the
 *   shared vocabulary, and the contract's rule is that capability outside the
 *   contract stays with the host.
 * - `sourceItems` are Source Items: top-level-only areas for an external video
 *   source, which may cut through the Frame. Also host-owned, and for the same
 *   reason — no Broadcast Graphics Screen has an external video source to place,
 *   and a Frame cutout is a Frame concern.
 * - `composition` is the shared item tree, held as exactly one composition because
 *   a Feature Match Overlay renders exactly one Feature Match Layout. It is a
 *   `BroadcastGraphicConfig` because that is the shape the shared compositor
 *   authors and the shared render model composes, not because a Feature Match
 *   Layout is a Broadcast Graphic.
 *
 * `items` is the legacy widget model. It stays until the contract ticket removes
 * it, so adopting the compositor cannot regress an overlay that already renders.
 */
export interface FeatureMatchLayoutConfig {
	frame: FeatureMatchLayoutFrameConfig;
	items: FeatureMatchLayoutItemConfig[];
	/** Host-owned Source Items, beneath and cutting through the Frame. */
	sourceItems?: FeatureMatchSourceItemConfig[];
	/**
	 * The shared Graphic Item tree. Absent on a layout authored before the
	 * compositor, which renders through the legacy model until an author adds to it.
	 */
	composition?: BroadcastGraphicConfig;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value as Record<string, unknown>
		: undefined;
}

function legacyNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Deterministically migrates pre-Graphic-Layer-Order layouts at every read
 * and write boundary. Existing z-index values are projected once into the
 * authoritative sibling list, then removed, and Widget-era structural names
 * become their Graphic Item and Graphic Group equivalents. Graphic Item
 * configuration migration itself belongs to each Graphic Item Definition.
 * Legacy image Widget asset values are not converted; they fail closed at the
 * schema boundary instead of being silently reshaped.
 */
export function normalizeFeatureMatchLayout(layout: FeatureMatchLayoutConfig): FeatureMatchLayoutConfig {
	// Layouts can arrive as Vue reactive proxies in the editor. A JSON round-trip
	// gives the persistence-shaped copy needed for migration without requiring
	// callers to unwrap framework-specific values first.
	const raw = JSON.parse(JSON.stringify(layout)) as {
		frame: FeatureMatchLayoutFrameConfig;
		items: Array<Record<string, unknown>>;
	};
	for (const item of raw.items) {
		if (item.type === 'widget') {
			item.type = 'graphic-item';
			item.graphicItem = item.widget;
			delete item.widget;
		}
		if (item.type === 'widget-group')
			item.type = 'graphic-group';
		if (item.type !== 'graphic-group' || !Array.isArray(item.children))
			continue;
		for (const child of item.children as Array<Record<string, unknown>>) {
			if (child.widget !== undefined) {
				child.graphicItem = child.widget;
				delete child.widget;
			}
			if (child.type === 'widget' || (!child.type && child.graphicItem))
				child.type = 'graphic-item';
		}
	}
	const source = raw as unknown as FeatureMatchLayoutConfig & {
		items: Array<FeatureMatchLayoutItemConfig & { zIndex?: number }>;
	};
	const hasLegacyItemOrder = source.items.some(item => typeof record(item)?.zIndex === 'number');
	const orderedItems = hasLegacyItemOrder
		? source.items
				.map((item, index) => ({
					item,
					index,
					order: item.type === 'media'
						? index
						: legacyNumber(record(item)?.zIndex, 0),
				}))
				.toSorted((left, right) => left.order - right.order || left.index - right.index)
				.map(entry => entry.item)
		: source.items;
	const items = orderedItems.map((item) => {
		const mutable = item as typeof item & Record<string, unknown>;
		delete mutable.zIndex;
		if (item.type === 'source')
			Object.assign(item, migrateFeatureMatchGraphicItemConfig(item));
		if (item.type === 'graphic-item') {
			item.graphicItem = migrateFeatureMatchGraphicItemConfig(item.graphicItem);
		}
		if (item.type === 'media') {
			Object.assign(item, migrateFeatureMatchGraphicItemConfig(item));
			item.focalPosition ??= { horizontal: 0.5, vertical: 0.5 };
		}
		if (item.type === 'graphic-group') {
			Object.assign(item, migrateFeatureMatchGraphicItemConfig(item));
			const hasLegacyChildOrder = item.children.some((child) => {
				const childLayout = record(child.layout);
				return typeof childLayout?.zIndex === 'number';
			});
			if (hasLegacyChildOrder) {
				item.children = item.children
					.map((child, index) => ({
						child,
						index,
						order: legacyNumber(record(child.layout)?.zIndex, index),
					}))
					.toSorted((left, right) => left.order - right.order || left.index - right.index)
					.map(entry => entry.child);
			}
			item.children = item.children.map((child) => {
				const mutableChild = child as unknown as Record<string, unknown>;
				const childLayout = child.layout as typeof child.layout & Record<string, unknown>;
				delete childLayout.zIndex;
				if (!mutableChild.type && mutableChild.graphicItem)
					mutableChild.type = 'graphic-item';
				if (child.type === 'media') {
					Object.assign(child, migrateFeatureMatchGraphicItemConfig(child));
					child.focalPosition ??= { horizontal: 0.5, vertical: 0.5 };
				}
				else {
					child.graphicItem = migrateFeatureMatchGraphicItemConfig(child.graphicItem);
				}
				return child;
			});
		}
		return item;
	});
	return { ...source, items };
}

export function normalizeFeatureMatchOverlayModeConfig(
	config: FeatureMatchOverlayModeConfig,
): FeatureMatchOverlayModeConfig {
	return {
		...config,
		layout: normalizeFeatureMatchLayout(config.layout),
	};
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
			{ id: 'main-source', type: 'source', label: 'Main Match Source', visible: true, sourceRole: 'main', frameCutout: true, x: 400, y: 90, width: 1500, height: 900, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
			{ id: 'player1-source', type: 'source', label: 'Player 1 Source', visible: true, sourceRole: 'player1', frameCutout: true, x: 24, y: 16, width: 340, height: 250, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
			{ id: 'player2-source', type: 'source', label: 'Player 2 Source', visible: true, sourceRole: 'player2', frameCutout: true, x: 24, y: 800, width: 340, height: 250, surfaceStyle: { backgroundColor: '#000000', backgroundOpacity: 0, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8 } },
			{ id: 'top-bar', type: 'graphic-group', label: 'Top Player Bar', visible: true, x: 400, y: 8, width: 1500, height: 74, surfaceStyle: { backgroundOpacity: 0 }, defaultChildSurfaceStyle: { textColor: '#ffffff', fontSize: 30, fontWeight: 800, backgroundOpacity: 0, overflow: 'ellipsis' }, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [
				{ id: 'top-name-record', label: 'Name and Record', visible: true, type: 'graphic-item', graphicItem: { type: 'text', playerSide: 'player1', template: '{name}\n{record}' }, layout: { mode: 'canvas', x: 0, y: 0, width: 300, height: 74 } },
				{ id: 'top-life', label: 'Life Total', visible: true, type: 'graphic-item', graphicItem: { type: 'player-life', playerSide: 'player1', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }, layout: { mode: 'canvas', x: 700, y: 4, width: 96, height: 66 }, surfaceStyle: { backgroundColor: '#333333', backgroundOpacity: 1, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8, textColor: '#ffffff', fontSize: 42, fontWeight: 800, textAlign: 'center' } },
				{ id: 'top-deck', label: 'Deck', visible: true, type: 'graphic-item', graphicItem: { type: 'text', playerSide: 'player1', template: '{deckColors} {deck}' }, layout: { mode: 'canvas', x: 820, y: 0, width: 500, height: 74 } },
				{ id: 'top-clock', label: 'Clock', visible: true, type: 'graphic-item', graphicItem: { type: 'clock' }, layout: { mode: 'canvas', x: 1360, y: 0, width: 140, height: 74 }, surfaceStyle: { fontSize: 28, fontWeight: 500, textAlign: 'right' } },
			] },
			{ id: 'bottom-bar', type: 'graphic-group', label: 'Bottom Player Bar', visible: true, x: 400, y: 1000, width: 1500, height: 74, surfaceStyle: { backgroundOpacity: 0 }, defaultChildSurfaceStyle: { textColor: '#ffffff', fontSize: 30, fontWeight: 800, backgroundOpacity: 0, overflow: 'ellipsis' }, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [
				{ id: 'bottom-name-record', label: 'Name and Record', visible: true, type: 'graphic-item', graphicItem: { type: 'text', playerSide: 'player2', template: '{name}\n{record}' }, layout: { mode: 'canvas', x: 0, y: 0, width: 300, height: 74 } },
				{ id: 'bottom-life', label: 'Life Total', visible: true, type: 'graphic-item', graphicItem: { type: 'player-life', playerSide: 'player2', lifeAnimation: 'glow', lifeAnimationDurationMs: 420, lifeAnimationAccentColor: '#ffffff' }, layout: { mode: 'canvas', x: 700, y: 4, width: 96, height: 66 }, surfaceStyle: { backgroundColor: '#333333', backgroundOpacity: 1, borderVisible: true, borderColor: '#0077a3', borderWidth: 4, borderRadius: 8, textColor: '#ffffff', fontSize: 42, fontWeight: 800, textAlign: 'center' } },
				{ id: 'bottom-deck', label: 'Deck', visible: true, type: 'graphic-item', graphicItem: { type: 'text', playerSide: 'player2', template: '{deckColors} {deck}' }, layout: { mode: 'canvas', x: 820, y: 0, width: 500, height: 74 } },
				{ id: 'bottom-details', label: 'Match Details', visible: true, type: 'graphic-item', graphicItem: { type: 'text', playerSide: 'player2', template: '{stage}\n{format}' }, layout: { mode: 'canvas', x: 1320, y: 0, width: 180, height: 74 }, surfaceStyle: { fontSize: 28, fontWeight: 700, textAlign: 'right' } },
			] },
			{ id: 'player1-game-wins', type: 'graphic-item', label: 'Player 1 Game Wins', visible: true, x: 24, y: 278, width: 340, height: 28, graphicItem: { type: 'game-wins', playerSide: 'player1', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 6, boxBorderWidth: 2 }, surfaceStyle: { backgroundColor: '#22c55e', backgroundOpacity: 0, borderVisible: true, borderColor: '#ffffff', borderWidth: 2, borderRadius: 999 } },
			{ id: 'player2-game-wins', type: 'graphic-item', label: 'Player 2 Game Wins', visible: true, x: 24, y: 760, width: 340, height: 28, graphicItem: { type: 'game-wins', playerSide: 'player2', displayMode: 'boxes', boxOrientation: 'horizontal', boxWidth: 22, boxHeight: 22, boxGap: 6, boxBorderWidth: 2 }, surfaceStyle: { backgroundColor: '#22c55e', backgroundOpacity: 0, borderVisible: true, borderColor: '#ffffff', borderWidth: 2, borderRadius: 999 } },
			{ id: 'branding', type: 'graphic-group', label: 'Event Branding', visible: true, x: 60, y: 360, width: 280, height: 280, surfaceStyle: { backgroundOpacity: 0 }, defaultChildSurfaceStyle: { textColor: '#ffffff', fontSize: 24, fontWeight: 700, backgroundOpacity: 0, textAlign: 'center' }, arrangement: { mode: 'canvas', padding: 0 }, overflow: 'clip', children: [
				{ id: 'branding-text', label: 'Event Name', visible: true, type: 'graphic-item', graphicItem: { type: 'text', template: '{eventName}' }, layout: { mode: 'canvas', x: 0, y: 0, width: 280, height: 80 } },
				{ id: 'branding-image-1', label: 'Image 1', visible: true, type: 'media', mediaKind: 'image', fit: 'contain', focalPosition: { horizontal: 0.5, vertical: 0.5 }, opacity: 1, layout: { mode: 'canvas', x: 0, y: 96, width: 132, height: 132 } },
				{ id: 'branding-image-2', label: 'Image 2', visible: true, type: 'media', mediaKind: 'image', fit: 'contain', focalPosition: { horizontal: 0.5, vertical: 0.5 }, opacity: 1, layout: { mode: 'canvas', x: 148, y: 96, width: 132, height: 132 } },
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
	const merged = stripNullConfigKeys({ ...currentModeConfig, ...partialConfig });
	return {
		...currentConfigs,
		[mode]: mode === 'feature-match-overlay'
			? normalizeFeatureMatchOverlayModeConfig(merged as unknown as FeatureMatchOverlayModeConfig)
			: merged,
	};
}
