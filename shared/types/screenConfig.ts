import type { AnimationEffectSelection, FeatureMatchOverlayFrameAnimationConfig } from '../animationEffects';
import type { ScreenModeConfigOf } from '../screenModeConfigs/contract';
import type { BackgroundLayersCapableMode } from '../screenModes';
import type { HorizontalAlign, ScreenColorMode, ScreenMode, VerticalAlign } from './enums';
import type { MediaFit } from './graphicItem';
import type { BroadcastGraphicConfig } from './graphics';
import type { GraphicAssetId, GraphicAssetRevisionId } from './graphicsAsset';
import { DEFAULT_FEATURE_MATCH_OVERLAY_CONFIG } from '../featureMatchOverlayPresets';
import { DEFAULT_BROADCAST_GRAPHICS_BACKGROUND, DEFAULT_FRAME_ANIMATION, DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '../screenGraphicsDefaults';
import { backgroundModeConfigContract } from '../screenModeConfigs/background';
import { broadcastGraphicsModeConfigContract } from '../screenModeConfigs/broadcastGraphics';
import { cardModeConfigContract } from '../screenModeConfigs/card';
import { deckModeConfigContract } from '../screenModeConfigs/deck';
import { featureMatchModeConfigContract } from '../screenModeConfigs/featureMatch';
import { featureMatchOverlayModeConfigContract } from '../screenModeConfigs/featureMatchOverlay';
import { metagameModeConfigContract } from '../screenModeConfigs/metagame';
import { playerHistoryModeConfigContract } from '../screenModeConfigs/playerHistory';
import { standingsModeConfigContract } from '../screenModeConfigs/standings';
import { topCardsModeConfigContract } from '../screenModeConfigs/topCards';
import { topCutModeConfigContract } from '../screenModeConfigs/topCut';

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

export type FeatureMatchOverlayGlowPosition = 'both' | 'inside' | 'outside';

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
	/** Which side of the Source Item border receives the glow. Absent means both. */
	glowPosition?: FeatureMatchOverlayGlowPosition;
}

/** The Feature Match Overlay Frame's own video. Always video, so it names no type. */
export interface ScreenMediaBackgroundConfig {
	enabled: boolean;
	source: ScreenMediaSource;
	fit: MediaFit;
	opacity: number;
	playbackRate: number;
	loop: boolean;
}

/**
 * A Screen Media Source: where a Screen's own image or video comes from — an
 * exact Graphic Asset Revision, or a Remote Media URL (ADR-0021).
 *
 * Offered on Background Layers and the Feature Match Overlay Frame only; Graphic
 * Items and Graphic Inputs stay library-only. The library arm pins an exact
 * revision, as a media Graphic Input value does. A URL source is a remote
 * dependency: the application serves nothing and checks nothing, and an empty
 * URL means unset. Never `MediaSource`, which would shadow the browser global.
 */
export type ScreenMediaSource
	= | { kind: 'asset'; assetId: GraphicAssetId; revisionId: GraphicAssetRevisionId }
		| { kind: 'url'; url: string };

/** A video ready to play: its Screen Media Source already resolved to a URL. */
export interface ScreenVideoPlayback {
	url: string;
	fit: MediaFit;
	opacity: number;
	playbackRate: number;
	loop: boolean;
}

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
	fit: MediaFit;
}

export interface VideoBackgroundLayer extends BackgroundLayerBase {
	type: 'video';
	source: ScreenMediaSource;
	fit: MediaFit;
	playbackRate: number;
	loop: boolean;
}

export interface AnimationBackgroundLayer extends BackgroundLayerBase {
	type: 'animation';
	animation: AnimationEffectSelection;
}

/**
 * One entry in an ordered Background Layer stack. Painter's order: the first
 * layer is the bottom of the stack.
 *
 * The Background Screen's configuration is such a stack; every mode whose
 * Screen Mode Definition declares one (see `ScreenModeDefinition.backgroundLayers`)
 * also carries an optional `backgroundLayers` stack of its own, painted behind
 * that mode's content.
 */
export type BackgroundLayer
	= | ColorBackgroundLayer
		| GradientBackgroundLayer
		| ImageBackgroundLayer
		| VideoBackgroundLayer
		| AnimationBackgroundLayer;

/**
 * What a mode's configuration gains by declaring a Background Layer stack. Not
 * written on any mode's own config type: `ModeConfigTypeMap` adds it to exactly
 * the declaring modes.
 */
export interface BackgroundLayersModeConfig {
	backgroundLayers?: BackgroundLayer[];
}

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

/**
 * Every Screen Mode's config is inferred from its config contract, which also
 * holds its defaults (ADR-0037). Re-exported here because this is where every
 * mode's config type lives, beside the Deck board helpers its contract module
 * owns. The Background Layer, Broadcast Graphic, and Feature Match Layout types
 * above stay hand-written: the server's schemas for those fields are typed to
 * produce them.
 */
export type { BackgroundModeConfig } from '../screenModeConfigs/background';
export type { BroadcastGraphicsModeConfig } from '../screenModeConfigs/broadcastGraphics';
export type { CardDisplayConfig, CardModeConfig } from '../screenModeConfigs/card';
export type { DeckBoardLayoutConfig, DeckModeConfig, DeckSource, ResolvedDeckBoardLayout, ResolvedDeckBoards } from '../screenModeConfigs/deck';
export { DEFAULT_DECK_BOARD_LAYOUT, DEFAULT_HIGHLANDER_POINTS_POSITION, DEFAULT_QUANTITY_POSITION, resolveDeckBoards } from '../screenModeConfigs/deck';
export type { FeatureMatchModeConfig } from '../screenModeConfigs/featureMatch';
export type { FeatureMatchOverlayModeConfig, FeatureMatchOverlayPresetId } from '../screenModeConfigs/featureMatchOverlay';
export type { MetagameArchetypeColumnConfig, MetagameCardColumnConfig, MetagameModeConfig } from '../screenModeConfigs/metagame';
export type { PlayerHistoryColumnConfig, PlayerHistoryModeConfig } from '../screenModeConfigs/playerHistory';
export type { StandingsColumnConfig, StandingsModeConfig } from '../screenModeConfigs/standings';
export type { TopCardsModeConfig } from '../screenModeConfigs/topCards';
export type { TopCutModeConfig } from '../screenModeConfigs/topCut';

export type FeatureMatchOverlayPlayerLifeAnimation = 'none' | 'fade' | 'pop' | 'slide' | 'glow';

export interface FeatureMatchOverlayFrameConfig extends FeatureMatchOverlayBorderSides {
	backgroundColor: string;
	opacity: number;
	backgroundImage?: ScreenMediaSource;
	backgroundImageFit?: MediaFit;
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
 * capability is verified by
 * `test/unit/shared/featureMatchOverlayCapabilityParity.test.ts` instead of by a
 * migration.
 */
export interface FeatureMatchLayoutConfig {
	frame: FeatureMatchLayoutFrameConfig;
	/** Graphic Layer Order of the host-owned Source Items, back to front. */
	sources: FeatureMatchSourceItemConfig[];
	/** The shared Graphic Item tree, composed above the Frame and the Source Items. */
	composition: BroadcastGraphicConfig;
}

export const DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH = 1920;
export const DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT = 1080;

/**
 * Every Screen Mode's config contract, which holds its defaults and authored
 * stacks. The same contracts as the Screen Mode Definitions' `config`, which
 * `test/unit/server/schemas/screenModeConfigContracts.test.ts` pins; listed here
 * because the definitions import this module.
 */
const MODE_CONFIG_CONTRACTS = {
	'background': backgroundModeConfigContract,
	'card': cardModeConfigContract,
	'deck': deckModeConfigContract,
	'standings': standingsModeConfigContract,
	'topCut': topCutModeConfigContract,
	'feature-match': featureMatchModeConfigContract,
	'feature-match-overlay': featureMatchOverlayModeConfigContract,
	'broadcast-graphics': broadcastGraphicsModeConfigContract,
	'metagame': metagameModeConfigContract,
	'top-cards': topCardsModeConfigContract,
	'player-history': playerHistoryModeConfigContract,
} as const;

/** Any one mode's config. */
export type ScreenModeConfig = ScreenModeConfigOf<(typeof MODE_CONFIG_CONTRACTS)[ScreenMode]>;

/**
 * Map of mode to config type: each mode's defaults, plus the optional
 * Background Layer stack for every mode whose definition declares one.
 */
export type ModeConfigTypeMap = {
	[M in ScreenMode]: ScreenModeConfigOf<(typeof MODE_CONFIG_CONTRACTS)[M]>
		& (M extends BackgroundLayersCapableMode ? BackgroundLayersModeConfig : unknown);
};

/**
 * Mode configurations as stored, the `modeConfigs` column: each one a fragment,
 * because a mode-configuration PATCH writes fragments and a full write accepts
 * what storage holds (ADR-0037). `resolveScreenModeConfig` completes one from its
 * mode's defaults.
 */
export type ModeConfigsMap = { [M in ScreenMode]?: Partial<ModeConfigTypeMap[M]> };

// ─── Nullable config types (for reset / clear-to-default operations) ───
// Sending `null` for a field means "delete this key from stored config".
export type NullableScreenConfig = { [K in keyof ScreenConfig]: ScreenConfig[K] | null };

/**
 * Keys a display reset must not touch. Two kinds qualify:
 *
 * - What the Screen points at: every Event Reference its Screen Mode Definition
 *   declares, such as the selected Feature Match Slot or Player, and the
 *   selection around them, such as Standings' view mode and slice. Resetting
 *   display settings should not unpick it. They are listed here, and
 *   `screenModeEventReferences.sqlite.test.ts` proves every declared Event
 *   Reference is.
 * - Authored content with no recovery path: a contract's authored stacks, such
 *   as a Broadcast Graphics Screen's stack of Broadcast Graphics, and every
 *   declaring mode's own `backgroundLayers` stack. Neither is listed here: see
 *   `getDisplayDefaultsForMode`. Resetting a Feature Match Layout restores a
 *   Feature Match Overlay Preset, a non-empty design the author can keep
 *   editing, whereas resetting the Broadcast Graphics stack would empty it, and
 *   there is no undo. The two are not the same action.
 */
type ModeResetPreservedKeysMap = {
	[K in ScreenMode]: readonly (keyof ModeConfigTypeMap[K])[];
};

const MODE_RESET_PRESERVED_KEYS = {
	'background': [],
	'card': ['featureMatchId'],
	'deck': ['deckSource'],
	'topCut': [],
	'feature-match': ['featureMatchId'],
	'feature-match-overlay': ['featureMatchId'],
	'broadcast-graphics': [],
	'standings': ['viewMode', 'topNCount', 'sliceStart', 'sliceEnd', 'playerListId', 'revealCount', 'roundId'],
	'metagame': ['viewMode', 'scope', 'topN', 'minPoints', 'playerListId', 'archetypeFilter'],
	'top-cards': ['scope', 'topN', 'playerListId', 'archetypeFilter'],
	'player-history': ['playerId'],
} as const satisfies ModeResetPreservedKeysMap;

// Helper to get default config for a mode
export function getDefaultConfigForMode<T extends ScreenMode>(mode: T): ModeConfigTypeMap[T] {
	return MODE_CONFIG_CONTRACTS[mode].defaults as ModeConfigTypeMap[T];
}

/**
 * One mode's saved configuration completed with its defaults — what a rendering
 * of that mode reads. The client's `useScreenModeConfig` and the server's Screen
 * Output reads both resolve through here, so the two cannot disagree about which
 * resource a Screen publishes (#604).
 */
export function resolveScreenModeConfig<T extends ScreenMode>(
	modeConfigs: ModeConfigsMap | null | undefined,
	mode: T,
): ModeConfigTypeMap[T] {
	const stored = modeConfigs?.[mode];
	return {
		...getDefaultConfigForMode(mode),
		...(stored && clampStoredModeConfig(mode, stored)),
	};
}

/** One mode's stored fragment read within its contract's bounds (`clampStored`, #498). */
function clampStoredModeConfig<T extends ScreenMode>(mode: T, stored: Partial<ModeConfigTypeMap[T]>): Partial<ModeConfigTypeMap[T]> {
	return MODE_CONFIG_CONTRACTS[mode].clampStored(stored as Record<string, unknown>) as Partial<ModeConfigTypeMap[T]>;
}

/**
 * Stored mode configurations as every reader reads them: each mode's fragment
 * with every number outside its contract's bounds pulled to the nearest bound.
 * A bound tightened after a Screen stored a value outside it reads as that bound,
 * never as the default, and the read is never refused (#498). The server applies
 * it to every Screen it sends a client, so an editor writing a value back sends
 * one in range; writes outside the bounds are still refused. A map already in
 * bounds is returned as it is.
 */
export function clampStoredModeConfigs<T extends ModeConfigsMap | null | undefined>(modeConfigs: T): T {
	if (!modeConfigs)
		return modeConfigs;
	let clamped: Record<string, unknown> | undefined;
	for (const [mode, stored] of Object.entries(modeConfigs)) {
		if (!stored || !Object.hasOwn(MODE_CONFIG_CONTRACTS, mode))
			continue;
		const next = clampStoredModeConfig(mode as ScreenMode, stored);
		if (next !== stored) {
			clamped ??= { ...modeConfigs };
			clamped[mode] = next;
		}
	}
	return (clamped ?? modeConfigs) as T;
}

/**
 * Returns the display-only defaults for a mode. "Reset to Defaults" writes them
 * (through `getDisplayResetForMode`, which restarts a Page Rotation), so
 * it omits every key a reset must preserve — what the Screen points at, such
 * as its `featureMatchId` Event Reference, and authored content such as a Broadcast Graphics Screen's
 * stack of Broadcast Graphics.
 */
export function getDisplayDefaultsForMode<T extends ScreenMode>(mode: T): Partial<ModeConfigTypeMap[T]> {
	const full = getDefaultConfigForMode(mode);
	const preservedKeys: readonly string[] = [
		...MODE_RESET_PRESERVED_KEYS[mode],
		...MODE_CONFIG_CONTRACTS[mode].authoredStacks,
		// A Background Layer stack is never a display default, whichever mode
		// declares it, so a reset can neither empty nor replace one.
		'backgroundLayers',
	];
	const display = { ...full } as Record<string, unknown>;
	for (const key of preservedKeys) {
		delete display[key];
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
