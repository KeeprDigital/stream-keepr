import type { DisplayType, ScreenMode } from './types/enums';
import { SCREEN_MODE_VALUES } from './types/enums';
import {
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
	DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
	DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT,
	DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH,
} from './types/screenConfig';

export interface ScreenModeContainerControls {
	dimensions?: boolean;
	padding?: boolean;
	textColors?: boolean;
	background?: boolean;
}

/**
 * The graphics host profile of a Screen Mode that renders a pixel-exact canvas
 * and exposes Overlay, Fill, and Key Screen Outputs.
 *
 * Declaring it here keeps host size, generic-control exclusions, dimension
 * placement, and output options together on the Screen Mode Definition instead
 * of scattering them across parallel per-mode lookup tables.
 */
export interface ScreenModeGraphicsHost {
	canvasWidth: number;
	canvasHeight: number;
	/** Feature Match Overlay still honours generic Screen alignment; a transparent host does not. */
	useScreenAlignment?: boolean;
}

export interface ScreenModeDefinition {
	label: string;
	icon: string;
	displayType: DisplayType;
	description: string;
	containerControls?: ScreenModeContainerControls;
	graphicsHost?: ScreenModeGraphicsHost;
	/**
	 * The mode carries its own optional `backgroundLayers` stack, painted behind
	 * its content by the Screen renderer host.
	 *
	 * Declared here and nowhere else. The config field and its validation,
	 * preservation across a display reset, the settings editor card, the painting,
	 * and Graphic Asset Reference discovery — and so the Screen write path's
	 * reference versioning and what the Screen Output may resolve — all derive
	 * from this flag, so a mode that declares it gets every one of them.
	 *
	 * The rule behind who declares it: every plain overlay mode qualifies.
	 * Control screens are operator surfaces, not program output; the Background
	 * Screen is itself the stack; and the graphics hosts (Feature Match Overlay,
	 * Broadcast Graphics) own their backgrounds and rely on transparent
	 * Overlay/Key Outputs, so a host-painted layer behind them would break keying.
	 */
	backgroundLayers?: true;
}

/** Generic Screen container controls a graphics host replaces with its own canvas and styling. */
const GRAPHICS_HOST_CONTAINER_CONTROLS: ScreenModeContainerControls = {
	padding: false,
	textColors: false,
	background: false,
};

export const DEFAULT_OVERLAY_CONTAINER_CONTROLS: Required<ScreenModeContainerControls> = {
	dimensions: true,
	padding: true,
	textColors: true,
	background: true,
};

/**
 * Single source of truth for all screen modes and their display characteristics.
 * Each mode declares its own display type, label, and icon, and the capabilities
 * it carries.
 *
 * Kept literal (`satisfies`, not an annotation) so a capability's modes can be
 * derived as a type as well as a list; `SCREEN_MODES` below is the same object
 * widened for readers asking about any mode.
 */
const SCREEN_MODE_DEFINITIONS = {
	'background': { label: 'Background', icon: 'i-lucide-wallpaper', displayType: 'overlay', description: 'Full-screen layered background' },
	'card': { label: 'Card', icon: 'i-lucide-square', displayType: 'overlay', description: 'Single card display', backgroundLayers: true },
	'deck': { label: 'Deck', icon: 'i-lucide-layers', displayType: 'overlay', description: 'Deck list view', backgroundLayers: true },
	'standings': { label: 'Standings', icon: 'i-lucide-trophy', displayType: 'overlay', description: 'Player standings', backgroundLayers: true },
	'topCut': { label: 'Top Cut', icon: 'i-lucide-git-branch', displayType: 'overlay', description: 'Top cut bracket', backgroundLayers: true },
	'feature-match': { label: 'Feature Match', icon: 'i-lucide-swords', displayType: 'control', description: 'Live feature match controls' },
	'feature-match-overlay': {
		label: 'Feature Match Overlay',
		icon: 'i-lucide-panels-top-left',
		displayType: 'overlay',
		description: 'Pixel-exact feature match overlay with fill/key outputs',
		containerControls: GRAPHICS_HOST_CONTAINER_CONTROLS,
		graphicsHost: {
			canvasWidth: DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH,
			canvasHeight: DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT,
		},
	},
	'broadcast-graphics': {
		label: 'Broadcast Graphics',
		icon: 'i-lucide-layout-template',
		displayType: 'overlay',
		description: 'Composed broadcast graphics stack with overlay/fill/key outputs',
		containerControls: GRAPHICS_HOST_CONTAINER_CONTROLS,
		graphicsHost: {
			canvasWidth: DEFAULT_BROADCAST_GRAPHICS_CANVAS_WIDTH,
			canvasHeight: DEFAULT_BROADCAST_GRAPHICS_CANVAS_HEIGHT,
			useScreenAlignment: false,
		},
	},
	'metagame': { label: 'Metagame', icon: 'i-lucide-pie-chart', displayType: 'overlay', description: 'Metagame breakdown', backgroundLayers: true },
	'top-cards': { label: 'Top Cards', icon: 'i-lucide-trending-up', displayType: 'overlay', description: 'Most played cards grid', backgroundLayers: true },
	'player-history': { label: 'Player History', icon: 'i-lucide-history', displayType: 'overlay', description: 'Player match history', backgroundLayers: true },
} as const satisfies Record<ScreenMode, ScreenModeDefinition>;

export const SCREEN_MODES: Record<ScreenMode, ScreenModeDefinition> = SCREEN_MODE_DEFINITIONS;

/** Derive the display type for a given screen mode. */
export function getDisplayType(mode: ScreenMode): DisplayType {
	return SCREEN_MODES[mode].displayType;
}

/** The Screen Modes whose definition declares a Background Layer stack. */
export type BackgroundLayersCapableMode = {
	[M in ScreenMode]: typeof SCREEN_MODE_DEFINITIONS[M] extends { backgroundLayers: true } ? M : never;
}[ScreenMode];

export function screenModeSupportsBackgroundLayers(mode: ScreenMode): mode is BackgroundLayersCapableMode {
	return SCREEN_MODES[mode].backgroundLayers === true;
}

/** The same modes as a list, in Screen Mode order, derived from the declaration. */
export const BACKGROUND_LAYERS_CAPABLE_MODES: readonly BackgroundLayersCapableMode[]
	= SCREEN_MODE_VALUES.filter(screenModeSupportsBackgroundLayers);

/** Derive which generic Container controls apply to a Screen Mode. */
export function getContainerControls(mode: ScreenMode): Required<ScreenModeContainerControls> {
	return {
		...DEFAULT_OVERLAY_CONTAINER_CONTROLS,
		...(SCREEN_MODES[mode].containerControls ?? {}),
	};
}

/**
 * The canvas a graphics Screen Mode defaults to, when a Screen has not yet been
 * given its own width and height. This is the one home for that number: editors
 * and Screen Outputs read it here rather than reaching for a loose constant.
 * Only a graphics host has a canvas, so asking about any other mode is a bug.
 */
export function getScreenModeGraphicsCanvas(mode: ScreenMode): { width: number; height: number } {
	const graphicsHost = SCREEN_MODES[mode].graphicsHost;
	if (!graphicsHost)
		throw new Error(`Screen Mode "${mode}" has no graphics host canvas.`);

	return { width: graphicsHost.canvasWidth, height: graphicsHost.canvasHeight };
}
