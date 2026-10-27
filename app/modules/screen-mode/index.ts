import type { Component, CSSProperties } from 'vue';
import type { EventCanvas } from '~~/shared/eventCanvas';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type {
	ScreenModeConfigurationPolicy,
	ScreenModeHostDefinition,
	ScreenModeHostKind,
	SharedScreenModeDefinition,
} from '~~/shared/screenModeDefinitions';
import type { DisplayType, ScreenMode } from '~~/shared/types/enums';
import { defineAsyncComponent } from 'vue';
import {
	getScreenModeSelectOptions,
	getScreenModeConfigurationPolicy as getSharedScreenModeConfigurationPolicy,
	getScreenModeDefinition as getSharedScreenModeDefinition,
	getScreenModeHostDefinition as getSharedScreenModeHostDefinition,
} from '~~/shared/screenModeDefinitions';
import { screenLayoutTokens } from './modeTokens';

const ScreenModesBackgroundDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/Background/Display.vue'));
const ScreenModesBackgroundSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/Background/Settings.vue'));
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
const ScreenModesTopCardsDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/TopCards/Display.vue'));
const ScreenModesTopCardsSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/TopCards/Settings.vue'));
const ScreenModesPlayerHistoryDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/PlayerHistory/Display.vue'));
const ScreenModesPlayerHistorySettings = defineAsyncComponent(() => import('~/components/Screen/Modes/PlayerHistory/Settings.vue'));
const ScreenModesPairingsDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/Pairings/Display.vue'));
const ScreenModesPairingsSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/Pairings/Settings.vue'));
const ScreenModesArchetypeSpotlightDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/ArchetypeSpotlight/Display.vue'));
const ScreenModesArchetypeSpotlightSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/ArchetypeSpotlight/Settings.vue'));
const ScreenModesHeadToHeadDisplay = defineAsyncComponent(() => import('~/components/Screen/Modes/HeadToHead/Display.vue'));
const ScreenModesHeadToHeadSettings = defineAsyncComponent(() => import('~/components/Screen/Modes/HeadToHead/Settings.vue'));

interface ScreenModeRuntimeDefinition {
	displayComponent: Component;
	settingsComponent?: Component;
}

interface ResolveScreenModeHostOptions {
	mode: ScreenMode;
	/** The Event Canvas: the coordinate space every overlay mode renders in (ADR-0051). */
	canvas: EventCanvas;
	/** The Event's Theme's stored values; the Default Theme stores none. */
	theme: StoredThemeTokens;
	/** The Screen's Screen Theme Overrides. */
	overrides: StoredThemeTokens;
	viewportWidth?: number;
	viewportHeight?: number;
}

export interface ResolvedScreenModeHost {
	kind: ScreenModeHostKind;
	containerClass: string;
	containerStyle: CSSProperties;
	provideOverlayContainer: boolean;
}

export interface ScreenModeDefinitionWithComponents extends SharedScreenModeDefinition, ScreenModeRuntimeDefinition {}

export const SCREEN_MODE_RUNTIME = {
	'background': { displayComponent: ScreenModesBackgroundDisplay, settingsComponent: ScreenModesBackgroundSettings },
	'card': { displayComponent: ScreenModesCardDisplay, settingsComponent: ScreenModesCardSettings },
	'deck': { displayComponent: ScreenModesDeckDisplay, settingsComponent: ScreenModesDeckSettings },
	'standings': { displayComponent: ScreenModesStandingsDisplay, settingsComponent: ScreenModesStandingsSettings },
	'top-cut': { displayComponent: ScreenModesTopCutDisplay, settingsComponent: ScreenModesTopCutSettings },
	'feature-match': { displayComponent: ScreenModesFeatureMatchDisplay, settingsComponent: ScreenModesFeatureMatchSettings },
	'feature-match-overlay': { displayComponent: ScreenModesFeatureMatchOverlayDisplay, settingsComponent: ScreenModesFeatureMatchOverlaySettings },
	'broadcast-graphics': { displayComponent: ScreenModesBroadcastGraphicsDisplay, settingsComponent: ScreenModesBroadcastGraphicsSettings },
	'metagame': { displayComponent: ScreenModesMetagameDisplay, settingsComponent: ScreenModesMetagameSettings },
	'top-cards': { displayComponent: ScreenModesTopCardsDisplay, settingsComponent: ScreenModesTopCardsSettings },
	'player-history': { displayComponent: ScreenModesPlayerHistoryDisplay, settingsComponent: ScreenModesPlayerHistorySettings },
	'pairings': { displayComponent: ScreenModesPairingsDisplay, settingsComponent: ScreenModesPairingsSettings },
	'archetype-spotlight': { displayComponent: ScreenModesArchetypeSpotlightDisplay, settingsComponent: ScreenModesArchetypeSpotlightSettings },
	'head-to-head': { displayComponent: ScreenModesHeadToHeadDisplay, settingsComponent: ScreenModesHeadToHeadSettings },
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

	// An operator surface: it fills its window in the app's own look (ADR-0051).
	if (host.kind === 'control') {
		return {
			kind: 'control',
			containerClass: 'screen-control-renderer w-full h-full overflow-hidden',
			containerStyle: {},
			provideOverlayContainer: false,
		};
	}

	const { width, height } = options.canvas;
	const style: CSSProperties = {
		width: `${width}px`,
		height: `${height}px`,
		flexShrink: '0',
	};

	/*
	 * Uniform viewport-fit scaling, decided by the Screen Mode Definition alone.
	 *
	 * Every overlay mode registers it (`fitToViewport`), so each renders its
	 * Event's canvas and no mode fills its window fluidly (ADR-0051). The caller
	 * gets no vote: when it had to ask, the output on air rendered its canvas 1:1
	 * and clipped everything outside the browser window (#232).
	 *
	 * Letterboxed rather than anchored: the canvas is centred in whatever space is
	 * left over on the axis that did not decide the scale. Every embedder sizes its
	 * frame to the canvas aspect ratio, so both offsets are zero there and this only
	 * shows on a window the canvas does not fit exactly.
	 */
	if (host.fitToViewport && options.viewportWidth && options.viewportHeight) {
		const scale = Math.min(options.viewportWidth / width, options.viewportHeight / height);
		const offsetX = (options.viewportWidth - width * scale) / 2;
		const offsetY = (options.viewportHeight - height * scale) / 2;
		style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
		style.transformOrigin = 'top left';
		style.margin = '0';
	}

	// A plain mode's content sits inside the Screen inset, where the Theme aligns it.
	const { inset, alignment } = screenLayoutTokens(options.theme, options.overrides);
	if (host.foundationTokens.includes('inset'))
		style.padding = `${inset}px`;
	if (host.foundationTokens.includes('alignment')) {
		style.justifyItems = HALIGN_MAP[alignment.horizontal];
		style.alignItems = VALIGN_MAP[alignment.vertical];
	}

	return {
		kind: 'overlay',
		containerClass: 'screen-renderer',
		containerStyle: style,
		provideOverlayContainer: true,
	};
}

export function getScreenModeSettingsComponent(mode: ScreenMode): Component | null {
	return getScreenModeDefinition(mode).settingsComponent ?? null;
}

export function isControlScreenMode(mode: ScreenMode): boolean {
	return getScreenModeDisplayType(mode) === 'control';
}

export { modeTokenVar, modeTypographyStyle, screenBackgroundLayers, screenLayoutTokens, screenModeThemeFontReferences, screenModeThemeTokenStyle } from './modeTokens';
export { usePaginatedScreenMode, useProjectedRotationPage, useScreenModePagination } from './pagination';
export type { ProjectedRotationPageOptions, ScreenModePaginationOptions } from './pagination';
export { getScreenModeSelectOptions };
export type {
	ScreenModeConfigurationPolicy,
	ScreenModeHostDefinition,
	ScreenModeSelectOption,
} from '~~/shared/screenModeDefinitions';
