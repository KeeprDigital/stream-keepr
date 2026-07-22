import type { InjectionKey, Ref } from 'vue';
import type { ScreenMode } from '~~/shared/types/enums';
import type { FeatureMatchOverlayOutput, ModeConfigTypeMap } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { getDefaultConfigForMode } from '~~/shared/types/screenConfig';

export interface ScreenContext {
	/** The active screen object */
	screen: Ref<Screen | null>;
	/** The event ID the screen belongs to */
	eventId: ComputedRef<number | null>;
	/** Whether the screen component should allow user interaction */
	interactive: Ref<boolean>;
	/** The rendered overlay container element */
	overlayContainer: Ref<HTMLElement | null>;
	/** Broadcast output variant requested by the route or preview. */
	outputMode?: Ref<FeatureMatchOverlayOutput>;
	/** Invalid output query value, shown in debug output only. */
	outputWarning?: Ref<string | null>;
	/** Scale fixed-size overlay output to fit the browser viewport for previews. */
	fitToViewport?: Ref<boolean>;
	/** True when the screen is embedded in the editor preview. */
	isPreview?: Ref<boolean>;
	/** Show editor-only guides in embedded previews. */
	previewGuides?: Ref<boolean>;
}

const SCREEN_CONTEXT_KEY: InjectionKey<ScreenContext> = Symbol('screen-context');

/**
 * Provide screen context to all descendant screen components.
 * Called once by the host page (display page, admin preview, etc.).
 */
export function provideScreenContext(context: ScreenContext) {
	provide(SCREEN_CONTEXT_KEY, context);
}

/**
 * Inject the screen context provided by an ancestor.
 * Throws if called outside of a screen context provider.
 */
export function useScreenContext(): ScreenContext {
	const context = inject(SCREEN_CONTEXT_KEY);
	if (!context) {
		throw new Error(
			'useScreenContext() was called outside of a screen context. '
			+ 'Ensure provideScreenContext() is called by an ancestor component.',
		);
	}
	return context;
}

/**
 * Get the resolved mode config for a given screen mode.
 * Merges stored config with defaults so consumers always get a complete config object.
 */
export function useScreenModeConfig<M extends ScreenMode>(mode: M): ComputedRef<ModeConfigTypeMap[M]> {
	const { screen } = useScreenContext();

	return computed<ModeConfigTypeMap[M]>(() => {
		const modeConfigs = (screen.value?.modeConfigs ?? {});
		return {
			...getDefaultConfigForMode(mode),
			...modeConfigs[mode],
		};
	});
}
