import type { Component, CSSProperties } from 'vue';
import type {
	ScreenModeConfigurationPolicy,
	ScreenModeHostDefinition,
	ScreenModeHostKind,
	SharedScreenModeDefinition,
} from '~~/shared/screenModeDefinitions';
import type { DisplayType, ScreenMode } from '~~/shared/types/enums';
import type { ScreenConfig } from '~~/shared/types/screenConfig';
import { defineAsyncComponent } from 'vue';
import {
	getScreenModeSelectOptions,
	getScreenModeConfigurationPolicy as getSharedScreenModeConfigurationPolicy,
	getScreenModeDefinition as getSharedScreenModeDefinition,
	getScreenModeHostDefinition as getSharedScreenModeHostDefinition,
} from '~~/shared/screenModeDefinitions';

const ScreenModesIdleDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/Idle/Display.vue'));
const ScreenModesIdleSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/Idle/Settings.vue'));
const ScreenModesCardDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/Card/Display.vue'));
const ScreenModesCardSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/Card/Settings.vue'));
const ScreenModesDeckDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/Deck/Display.vue'));
const ScreenModesDeckSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/Deck/Settings.vue'));
const ScreenModesStandingsDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/Standings/Display.vue'));
const ScreenModesStandingsSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/Standings/Settings.vue'));
const ScreenModesTopCutDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/TopCut/Display.vue'));
const ScreenModesTopCutSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/TopCut/Settings.vue'));
const ScreenModesFeatureMatchDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/FeatureMatch/Display.vue'));
const ScreenModesFeatureMatchSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/FeatureMatch/Settings.vue'));
const ScreenModesFeatureMatchOverlayDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/FeatureMatchOverlay/Display.vue'));
const ScreenModesFeatureMatchOverlaySettings = defineAsyncComponent(() => import('~/components/Screen/Modes/FeatureMatchOverlay/Settings.vue'));
const ScreenModesBroadcastGraphicsDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/BroadcastGraphics/Display.vue'));
const ScreenModesBroadcastGraphicsSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/BroadcastGraphics/Settings.vue'));
const ScreenModesMetagameDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/Metagame/Display.vue'));
const ScreenModesMetagameSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/Metagame/Settings.vue'));
const ScreenModesPlayerHistoryDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/PlayerHistory/Display.vue'));
const ScreenModesPlayerHistorySettings = defineAsyncComponent(() => import('~/components/Screen/Modes/PlayerHistory/Settings.vue'));

interface ScreenModeRuntimeDefinition {
	displayComponent: Component;
	settingsComponent?: Component;
}

interface ResolveScreenModeHostOptions {
	mode: ScreenMode;
	screenConfig: ScreenConfig;
	viewportWidth?: number;
	viewportHeight?: number;
	preferredDark?: boolean;
}

export interface ResolvedScreenModeHost {
	kind: ScreenModeHostKind;
	containerClass: string;
	containerStyle: CSSProperties;
	wrapperClass: string[];
	wrapperStyle: CSSProperties;
	provideOverlayContainer: boolean;
}

export interface ScreenModeDefinitionWithComponents extends SharedScreenModeDefinition, ScreenModeRuntimeDefinition {}

export const SCREEN_MODE_RUNTIME = {
	'idle': { displayComponent: ScreenModesIdleDisplay, settingsComponent: ScreenModesIdleSettings },
	'card': { displayComponent: ScreenModesCardDisplay, settingsComponent: ScreenModesCardSettings },
	'deck': { displayComponent: ScreenModesDeckDisplay, settingsComponent: ScreenModesDeckSettings },
	'standings': { displayComponent: ScreenModesStandingsDisplay, settingsComponent: ScreenModesStandingsSettings },
	'topCut': { displayComponent: ScreenModesTopCutDisplay, settingsComponent: ScreenModesTopCutSettings },
	'feature-match': { displayComponent: ScreenModesFeatureMatchDisplay, settingsComponent: ScreenModesFeatureMatchSettings },
	'feature-match-overlay': { displayComponent: ScreenModesFeatureMatchOverlayDisplay, settingsComponent: ScreenModesFeatureMatchOverlaySettings },
	'broadcast-graphics': { displayComponent: ScreenModesBroadcastGraphicsDisplay, settingsComponent: ScreenModesBroadcastGraphicsSettings },
	'metagame': { displayComponent: ScreenModesMetagameDisplay, settingsComponent: ScreenModesMetagameSettings },
	'player-history': { displayComponent: ScreenModesPlayerHistoryDisplay, settingsComponent: ScreenModesPlayerHistorySettings },
} satisfies { [M in ScreenMode]: ScreenModeRuntimeDefinition };

const HALIGN_MAP = { left: 'start', center: 'center', right: 'end' } as const;
const VALIGN_MAP = { top: 'start', center: 'center', bottom: 'end' } as const;

/**
 * Screen Mode Definition seam.
 *
 * Callers ask this module for the selected Screen Mode Definition rather than
 * assembling shared metadata, display type, display components, and settings
 * components separately.
 */
export function getScreenModeDefinition(mode: ScreenMode): ScreenModeDefinitionWithComponents {
	const sharedDefinition = getSharedScreenModeDefinition(mode);
	const components = SCREEN_MODE_RUNTIME[mode];

	return {
		...sharedDefinition,
		...components,
	};
}

export function getScreenModeLabel(mode: ScreenMode): string {
	return getScreenModeDefinition(mode).label;
}

export function getScreenModeIcon(mode: ScreenMode): string {
	return getScreenModeDefinition(mode).icon;
}

export function getScreenModeDisplayType(mode: ScreenMode): DisplayType {
	return getScreenModeDefinition(mode).displayType;
}

export function getScreenModeHostDefinition(mode: ScreenMode): ScreenModeHostDefinition {
	return getSharedScreenModeHostDefinition(mode);
}

export function getScreenModeConfigurationPolicy(mode: ScreenMode): ScreenModeConfigurationPolicy {
	return getSharedScreenModeConfigurationPolicy(mode);
}

export function resolveScreenModeHost(options: ResolveScreenModeHostOptions): ResolvedScreenModeHost {
	const host = getScreenModeHostDefinition(options.mode);
	const config = options.screenConfig;

	if (host.kind === 'control') {
		const paddingX = host.useScreenPadding ? (config.paddingX ?? 0) : 0;
		const paddingY = host.useScreenPadding ? (config.paddingY ?? 0) : 0;
		const theme = resolveScreenModeHostTheme(host, config, options.preferredDark);

		return {
			kind: 'control',
			containerClass: 'screen-control-renderer w-full h-full overflow-hidden',
			containerStyle: {
				padding: `${paddingY}px ${paddingX}px`,
			},
			wrapperClass: theme ? [theme] : [],
			wrapperStyle: theme ? { colorScheme: theme } : {},
			provideOverlayContainer: false,
		};
	}

	const width = config.width ?? host.defaultWidth;
	const height = config.height ?? host.defaultHeight;
	const paddingX = host.useScreenPadding ? (config.paddingX ?? 0) : 0;
	const paddingY = host.useScreenPadding ? (config.paddingY ?? 0) : 0;
	const style: CSSProperties = {
		width: width ? `${width}px` : '100%',
		height: height ? `${height}px` : '100%',
		flexShrink: '0',
		padding: `${paddingY}px ${paddingX}px`,
	};

	/*
	 * Uniform viewport-fit scaling, decided by the Screen Mode Definition alone.
	 *
	 * The mode registers whether its host scales (`fitToViewport`), and nothing else
	 * gets a vote. It used to also require the caller to ask, and only the surfaces
	 * that *embed* an output ever did — so the one output nobody embeds, the one on
	 * air, rendered its canvas 1:1 and clipped everything outside the browser window.
	 * At exactly 1920×1080 that is invisible, which is why it survived to #232.
	 *
	 * Letterboxed rather than anchored: the canvas is centred in whatever space is
	 * left over on the axis that did not decide the scale. Every embedder sizes its
	 * frame to the canvas aspect ratio, so both offsets are zero there and this only
	 * shows on a window the canvas does not fit exactly.
	 */
	if (host.fitToViewport && width && height && options.viewportWidth && options.viewportHeight) {
		const scale = Math.min(options.viewportWidth / width, options.viewportHeight / height);
		const offsetX = (options.viewportWidth - width * scale) / 2;
		const offsetY = (options.viewportHeight - height * scale) / 2;
		style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
		style.transformOrigin = 'top left';
		style.margin = '0';
	}

	if (host.useScreenBackground && config.background) {
		style.background = config.background;
	}

	if (host.useScreenAlignment) {
		const hAlign = config.horizontalAlign ?? 'center';
		const vAlign = config.verticalAlign ?? 'center';
		style.justifyItems = HALIGN_MAP[hAlign];
		style.alignItems = VALIGN_MAP[vAlign];
	}

	return {
		kind: 'overlay',
		containerClass: 'screen-renderer',
		containerStyle: style,
		wrapperClass: [],
		wrapperStyle: {},
		provideOverlayContainer: true,
	};
}

function resolveScreenModeHostTheme(host: ScreenModeHostDefinition, config: ScreenConfig, preferredDark = false): 'light' | 'dark' | null {
	if (host.themePolicy !== 'screen-color-mode')
		return null;

	const mode = config.colorMode ?? 'system';
	if (mode === 'system')
		return preferredDark ? 'dark' : 'light';

	return mode;
}

export function getScreenModeSettingsComponent(mode: ScreenMode): Component | null {
	return getScreenModeDefinition(mode).settingsComponent ?? null;
}

export function isControlScreenMode(mode: ScreenMode): boolean {
	return getScreenModeDisplayType(mode) === 'control';
}

export { useScreenModePagination } from './pagination';
export type { ScreenModePaginationOptions } from './pagination';
export { getScreenModeSelectOptions };
export type {
	ScreenModeConfigurationPolicy,
	ScreenModeHostDefinition,
	ScreenModeSelectOption,
} from '~~/shared/screenModeDefinitions';
