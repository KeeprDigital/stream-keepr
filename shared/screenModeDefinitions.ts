import type { PageRotationConfig } from './screenModeConfigs/subShapes';
import type { ScreenModeContainerControls } from './screenModes';
import type { DisplayType, ScreenMode } from './types/enums';
import type { ModeConfigTypeMap, ScreenConfig, ScreenOutput } from './types/screenConfig';
import { pageRotationEdit } from './modules/page-rotation';
import { getContainerControls, SCREEN_MODES } from './screenModes';
import {
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
	value: ScreenOutput;
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
	/**
	 * Whether the Screen configuration page gives this mode the full page width
	 * and collapses generic container settings. A graphics host embeds the
	 * compositor's tree, preview, and inspector side by side and needs it.
	 */
	fullWidthConfiguration: boolean;
}

export interface SharedScreenModeDefinition<M extends ScreenMode = ScreenMode> {
	mode: M;
	label: string;
	icon: string;
	description: string;
	displayType: DisplayType;
	host: ScreenModeHostDefinition;
	getDefaultConfig: () => ModeConfigTypeMap[M];
	/** The write a display reset makes (`getDisplayResetForMode`). */
	getDisplayReset: (current: Partial<ModeConfigTypeMap[M]>, now: number) => Partial<ModeConfigTypeMap[M]>;
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

/**
 * The graphics Screen Outputs, in the order an editor names, previews and hands them
 * out. One list so a Screen Output looks the same wherever it is offered: the
 * preview's output switch shows these labels, and the Screen's "Open … output"
 * actions are named from them.
 */
export const SCREEN_OUTPUT_OPTIONS = [
	{ label: 'Overlay', value: 'overlay', icon: 'i-lucide-layers' },
	{ label: 'Fill', value: 'fill', icon: 'i-lucide-square' },
	{ label: 'Key', value: 'key', icon: 'i-lucide-contrast' },
] as const satisfies ReadonlyArray<{ label: string; value: ScreenOutput; icon: string }>;

/** The "Open … output" actions every graphics host exposes. */
const OPEN_SCREEN_OUTPUT_OPTIONS: ScreenModeOutputOption[] = SCREEN_OUTPUT_OPTIONS.map(option => ({
	value: option.value,
	label: `Open ${option.label.toLowerCase()} output`,
	icon: option.icon,
}));

const DEFAULT_CONTAINER_CONTROL_PLACEMENT: ScreenModeConfigurationPolicy['containerControlPlacement'] = {
	dimensions: 'container',
	padding: 'container',
	textColors: 'container',
	background: 'container',
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
	const graphicsHost = sharedDefinition.graphicsHost;

	if (!graphicsHost)
		return { ...base };

	return {
		...base,
		defaultWidth: graphicsHost.canvasWidth,
		defaultHeight: graphicsHost.canvasHeight,
		useScreenPadding: false,
		useScreenBackground: false,
		useScreenAlignment: graphicsHost.useScreenAlignment ?? base.useScreenAlignment,
	};
}

export function getScreenModeConfigurationPolicy(mode: ScreenMode): ScreenModeConfigurationPolicy {
	const sharedDefinition = SCREEN_MODES[mode];
	const host = getScreenModeHostDefinition(mode);
	const graphicsHost = sharedDefinition.graphicsHost;
	const fixedDimensions = host.defaultWidth && host.defaultHeight;

	return {
		displayType: sharedDefinition.displayType,
		containerControls: getContainerControls(mode),
		containerControlPlacement: {
			...DEFAULT_CONTAINER_CONTROL_PLACEMENT,
			// A graphics host owns its canvas, so its dimension controls sit with the mode.
			...(graphicsHost
				? { dimensions: 'mode' as const }
				: {}),
		},
		dimensions: {
			width: getScreenModeDimensionControl('width', host.defaultWidth),
			height: getScreenModeDimensionControl('height', host.defaultHeight),
		},
		resetScreenConfigDefaults: fixedDimensions
			? { width: host.defaultWidth, height: host.defaultHeight }
			: undefined,
		outputOptions: graphicsHost
			? OPEN_SCREEN_OUTPUT_OPTIONS
			: [],
		fullWidthConfiguration: Boolean(graphicsHost),
	};
}

export function getScreenModeDefinition<M extends ScreenMode>(mode: M): SharedScreenModeDefinition<M> {
	const sharedDefinition = SCREEN_MODES[mode];

	return {
		mode,
		...sharedDefinition,
		host: getScreenModeHostDefinition(mode),
		getDefaultConfig: () => getDefaultConfigForMode(mode),
		getDisplayReset: (current, now) => getDisplayResetForMode(mode, current, now),
		configurationPolicy: getScreenModeConfigurationPolicy(mode),
	};
}

/**
 * The write a display reset ("Reset to Defaults") makes: the mode's display
 * defaults (`getDisplayDefaultsForMode`). For a paginated mode that restores
 * the default page size and page duration, a change of the rotation's shape,
 * so the reset goes through the one rule for those (`pageRotationEdit`,
 * ADR-0039): it restarts the rotation from page 1, with a Rotation Anchor of
 * now only if auto-page is on once reset.
 *
 * `current` is the mode's config as the reset finds it, which decides
 * auto-page should a reset ever preserve it.
 */
export function getDisplayResetForMode<M extends ScreenMode>(
	mode: M,
	current: Partial<ModeConfigTypeMap[M]>,
	now: number,
): Partial<ModeConfigTypeMap[M]> {
	const display = getDisplayDefaultsForMode(mode);
	const declaration = SCREEN_MODES[mode].pageRotation;
	if (!declaration)
		return display;
	const reset: Partial<Record<keyof PageRotationConfig, unknown>> = {
		...current,
		...display,
	};
	return pageRotationEdit(declaration, { autoPageEnabled: reset.autoPageEnabled === true }, display, now);
}

export function getScreenModeSelectOptions(): ScreenModeSelectOption[] {
	return Object.entries(SCREEN_MODES).map(([mode, definition]) => ({
		label: definition.label,
		value: mode as ScreenMode,
		icon: definition.icon,
	}));
}
