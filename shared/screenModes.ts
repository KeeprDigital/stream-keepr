import type { DisplayType, ScreenMode } from './types/enums';
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
 * Each mode declares its own display type, label, and icon.
 */
export const SCREEN_MODES: Record<ScreenMode, ScreenModeDefinition> = {
	'background': { label: 'Background', icon: 'i-lucide-wallpaper', displayType: 'overlay', description: 'Full-screen layered background' },
	'card': { label: 'Card', icon: 'i-lucide-square', displayType: 'overlay', description: 'Single card display' },
	'deck': { label: 'Deck', icon: 'i-lucide-layers', displayType: 'overlay', description: 'Deck list view' },
	'standings': { label: 'Standings', icon: 'i-lucide-trophy', displayType: 'overlay', description: 'Player standings' },
	'topCut': { label: 'Top Cut', icon: 'i-lucide-git-branch', displayType: 'overlay', description: 'Top cut bracket' },
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
	'metagame': { label: 'Metagame', icon: 'i-lucide-pie-chart', displayType: 'overlay', description: 'Metagame breakdown' },
	'player-history': { label: 'Player History', icon: 'i-lucide-history', displayType: 'overlay', description: 'Player match history' },
} as const;

/** Derive the display type for a given screen mode. */
export function getDisplayType(mode: ScreenMode): DisplayType {
	return SCREEN_MODES[mode].displayType;
}

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
