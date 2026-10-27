import type { FoundationTokenName } from './modules/theme/vocabulary';
import type { PageRotationConfig } from './screenModeConfigs/subShapes';
import type { DisplayType, ScreenMode } from './types/enums';
import type { ModeConfigTypeMap, ScreenOutput } from './types/screenConfig';
import { pageRotationEdit } from './modules/page-rotation';
import { SCREEN_MODES, screenModeSupportsBackgroundLayers } from './screenModes';
import {
	getDefaultConfigForMode,
	getDisplayDefaultsForMode,
} from './types/screenConfig';

export type ScreenModeHostKind = 'overlay' | 'control';

export interface ScreenModeHostDefinition {
	kind: ScreenModeHostKind;
	/** The host renders its Event Canvas scaled uniformly to fit its window (ADR-0051). */
	fitToViewport: boolean;
	/**
	 * The Foundation Tokens the host consumes itself, rather than through a Mode
	 * Token: a plain mode's host insets and aligns its content in the Event
	 * Canvas. They join what the Screen consumes, so a Screen may override them.
	 */
	foundationTokens: readonly FoundationTokenName[];
}

export interface ScreenModeOutputOption {
	value: ScreenOutput;
	label: string;
	icon: string;
}

export interface ScreenModeConfigurationPolicy {
	displayType: DisplayType;
	outputOptions: ScreenModeOutputOption[];
	/**
	 * Whether the Screen configuration page gives this mode the full page width.
	 * A graphics host embeds the
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

/** What a plain overlay mode's host consumes: it insets and aligns the mode's content. */
const PLAIN_HOST_TOKENS = ['inset', 'alignment'] as const satisfies readonly FoundationTokenName[];

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

/**
 * How a Screen Mode is hosted.
 *
 * - A plain overlay mode, one carrying a Background Layer stack, renders in its
 *   Event Canvas, inset and aligned by the `inset` and `alignment` Foundation
 *   Tokens.
 * - The Background Screen and the graphics hosts render in their Event Canvas
 *   edge to edge, and take no Theme Token of their own.
 * - Feature Match Controls, an operator surface, fills its window in the app's
 *   own look and consumes no Theme Token.
 */
export function getScreenModeHostDefinition(mode: ScreenMode): ScreenModeHostDefinition {
	if (SCREEN_MODES[mode].displayType === 'control')
		return { kind: 'control', fitToViewport: false, foundationTokens: [] };
	return {
		kind: 'overlay',
		fitToViewport: true,
		foundationTokens: screenModeSupportsBackgroundLayers(mode)
			? PLAIN_HOST_TOKENS
			: [],
	};
}

/** The Foundation Tokens a Screen Mode's host consumes itself. */
export function screenModeHostTokens(mode: ScreenMode): readonly FoundationTokenName[] {
	return getScreenModeHostDefinition(mode).foundationTokens;
}

export function getScreenModeConfigurationPolicy(mode: ScreenMode): ScreenModeConfigurationPolicy {
	const sharedDefinition = SCREEN_MODES[mode];
	const graphicsHost = sharedDefinition.graphicsHost;

	return {
		displayType: sharedDefinition.displayType,
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
