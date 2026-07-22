import type { ScreenModeContainerControls } from './screenModes';
import type { DisplayType, ScreenMode } from './types/enums';
import type { FeatureMatchOverlayOutput, ModeConfigTypeMap, ScreenConfig } from './types/screenConfig';
import { getContainerControls, SCREEN_MODES } from './screenModes';
import {
	DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT,
	DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH,
	getDefaultConfigForMode,
	getDisplayDefaultsForMode,
} from './types/screenConfig';

export type ScreenModeHostKind = 'overlay' | 'control';
export type ScreenModeThemePolicy = 'none' | 'screen-color-mode';
export type ScreenModeDimensionField = 'width' | 'height';
export type ScreenModeContainerControlPlacement = 'container' | 'mode';

export interface ScreenModeHostDefinition {
	kind: ScreenModeHostKind;
	defaultWidth?: number;
	defaultHeight?: number;
	useScreenPadding: boolean;
	useScreenBackground: boolean;
	useScreenAlignment: boolean;
	fitToViewport: boolean;
	themePolicy: ScreenModeThemePolicy;
}

export interface ScreenModeOutputOption {
	value: FeatureMatchOverlayOutput;
	label: string;
	icon: string;
}

export interface ScreenModeDimensionControl {
	defaultValue: number | null;
	placeholder: string;
	description: string;
}

export interface ScreenModeConfigurationPolicy {
	displayType: DisplayType;
	containerControls: Required<ScreenModeContainerControls>;
	containerControlPlacement: Record<keyof Required<ScreenModeContainerControls>, ScreenModeContainerControlPlacement>;
	dimensions: Record<ScreenModeDimensionField, ScreenModeDimensionControl>;
	resetScreenConfigDefaults?: Partial<ScreenConfig>;
	outputOptions: ScreenModeOutputOption[];
}

export interface SharedScreenModeDefinition<M extends ScreenMode = ScreenMode> {
	mode: M;
	label: string;
	icon: string;
	description: string;
	displayType: DisplayType;
	host: ScreenModeHostDefinition;
	getDefaultConfig: () => ModeConfigTypeMap[M];
	getDisplayDefaults: () => Partial<ModeConfigTypeMap[M]>;
	configurationPolicy: ScreenModeConfigurationPolicy;
}

export interface ScreenModeSelectOption {
	label: string;
	value: ScreenMode;
	icon: string;
}

const OVERLAY_HOST_DEFAULTS: ScreenModeHostDefinition = {
	kind: 'overlay',
	useScreenPadding: true,
	useScreenBackground: true,
	useScreenAlignment: true,
	fitToViewport: true,
	themePolicy: 'none',
};

const CONTROL_HOST_DEFAULTS: ScreenModeHostDefinition = {
	kind: 'control',
	useScreenPadding: true,
	useScreenBackground: false,
	useScreenAlignment: false,
	fitToViewport: false,
	themePolicy: 'screen-color-mode',
};

const SCREEN_MODE_HOST_OVERRIDES: Partial<Record<ScreenMode, Partial<ScreenModeHostDefinition>>> = {
	'feature-match-overlay': {
		defaultWidth: DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_WIDTH,
		defaultHeight: DEFAULT_FEATURE_MATCH_OVERLAY_SCREEN_HEIGHT,
		useScreenPadding: false,
		useScreenBackground: false,
	},
};

const FEATURE_MATCH_OVERLAY_OUTPUT_OPTIONS: ScreenModeOutputOption[] = [
	{ value: 'overlay', label: 'Open overlay output', icon: 'i-lucide-panel-top' },
	{ value: 'fill', label: 'Open fill output', icon: 'i-lucide-square' },
	{ value: 'key', label: 'Open key output', icon: 'i-lucide-contrast' },
];

const DEFAULT_CONTAINER_CONTROL_PLACEMENT: ScreenModeConfigurationPolicy['containerControlPlacement'] = {
	dimensions: 'container',
	padding: 'container',
	textColors: 'container',
	background: 'container',
};

const CONTAINER_CONTROL_PLACEMENT_OVERRIDES: Partial<Record<ScreenMode, Partial<ScreenModeConfigurationPolicy['containerControlPlacement']>>> = {
	'feature-match-overlay': {
		dimensions: 'mode',
	},
};

function getScreenModeDimensionControl(field: ScreenModeDimensionField, defaultValue?: number): ScreenModeDimensionControl {
	if (defaultValue) {
		return {
			defaultValue,
			placeholder: String(defaultValue),
			description: `Pixel-exact output ${field} in pixels.`,
		};
	}

	return {
		defaultValue: null,
		placeholder: 'Auto',
		description: `Overlay ${field} in pixels. Leave empty to fill the viewport.`,
	};
}

export function getScreenModeHostDefinition(mode: ScreenMode): ScreenModeHostDefinition {
	const sharedDefinition = SCREEN_MODES[mode];
	const base = sharedDefinition.displayType === 'control'
		? CONTROL_HOST_DEFAULTS
		: OVERLAY_HOST_DEFAULTS;

	return {
		...base,
		...SCREEN_MODE_HOST_OVERRIDES[mode],
	};
}

export function getScreenModeConfigurationPolicy(mode: ScreenMode): ScreenModeConfigurationPolicy {
	const sharedDefinition = SCREEN_MODES[mode];
	const host = getScreenModeHostDefinition(mode);
	const fixedDimensions = host.defaultWidth && host.defaultHeight;

	return {
		displayType: sharedDefinition.displayType,
		containerControls: getContainerControls(mode),
		containerControlPlacement: {
			...DEFAULT_CONTAINER_CONTROL_PLACEMENT,
			...(CONTAINER_CONTROL_PLACEMENT_OVERRIDES[mode] ?? {}),
		},
		dimensions: {
			width: getScreenModeDimensionControl('width', host.defaultWidth),
			height: getScreenModeDimensionControl('height', host.defaultHeight),
		},
		resetScreenConfigDefaults: fixedDimensions
			? { width: host.defaultWidth, height: host.defaultHeight }
			: undefined,
		outputOptions: mode === 'feature-match-overlay' ? FEATURE_MATCH_OVERLAY_OUTPUT_OPTIONS : [],
	};
}

export function getScreenModeDefinition<M extends ScreenMode>(mode: M): SharedScreenModeDefinition<M> {
	const sharedDefinition = SCREEN_MODES[mode];

	return {
		mode,
		...sharedDefinition,
		host: getScreenModeHostDefinition(mode),
		getDefaultConfig: () => getDefaultConfigForMode(mode),
		getDisplayDefaults: () => getDisplayDefaultsForMode(mode),
		configurationPolicy: getScreenModeConfigurationPolicy(mode),
	};
}

export function getScreenModeSelectOptions(): ScreenModeSelectOption[] {
	return Object.entries(SCREEN_MODES).map(([mode, definition]) => ({
		label: definition.label,
		value: mode as ScreenMode,
		icon: definition.icon,
	}));
}
