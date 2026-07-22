import type { DisplayType, ScreenMode } from './types/enums';

export interface ScreenModeContainerControls {
	dimensions?: boolean;
	padding?: boolean;
	textColors?: boolean;
	background?: boolean;
}

export interface ScreenModeDefinition {
	label: string;
	icon: string;
	displayType: DisplayType;
	description: string;
	containerControls?: ScreenModeContainerControls;
}

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
	'idle': { label: 'Idle', icon: 'i-lucide-pause', displayType: 'overlay', description: 'Empty state' },
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
		containerControls: {
			padding: false,
			textColors: false,
			background: false,
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
