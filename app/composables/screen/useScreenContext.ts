import type { InjectionKey, Ref } from 'vue';
import type { ScreenMode } from '~~/shared/types/enums';
import type { ModeConfigTypeMap, ScreenOutput } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import type { ScreenCardDataHealth } from '~/types/screen';
import { resolveScreenModeConfig } from '~~/shared/types/screenConfig';

export interface ScreenContext {
	/** The active screen object */
	screen: Ref<Screen | null>;
	/** The event ID the screen belongs to */
	eventId: ComputedRef<number | null>;
	/** Whether the screen component should allow user interaction */
	interactive: Ref<boolean>;
	/** The rendered overlay container element */
	overlayContainer: Ref<HTMLElement | null>;
	/** Screen Output variant requested by the route or preview. */
	outputMode?: Ref<ScreenOutput>;
	/** Invalid output query value, shown in debug output only. */
	outputWarning?: Ref<string | null>;
	/** True when the screen is embedded in the editor preview. */
	isPreview?: Ref<boolean>;
	/** Show editor-only item guides in embedded previews. */
	previewGuides?: Ref<boolean>;
	/** Show advisory action-safe and title-safe guides in embedded previews. */
	previewSafeAreas?: Ref<boolean>;
	/** Opaque capability supplied to an unattended Screen Output via its URL fragment. */
	assetCapability?: Ref<string | null>;
	/**
	 * Where the rendering self-reports whether it resolved all its card data.
	 * Owned by the host so it can carry the report to control surfaces (via
	 * presence, like `assetAccess`) instead of showing it on program (#465).
	 */
	cardDataHealth?: Ref<ScreenCardDataHealth>;
}

const SCREEN_CONTEXT_KEY: InjectionKey<ScreenContext> = Symbol('screen-context');

/** The context `runInScreenContext` is setting up under, if any. */
let contextBeingSetUp: ScreenContext | null = null;

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
	if (contextBeingSetUp)
		return contextBeingSetUp;
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
 * Sets up `setup` — a Screen Mode's data composable — against `context` rather
 * than an ancestor's, so a surface that is no rendering of the Screen, such as
 * a mode's settings editor, reads what its renderings read (#780). Every
 * `useScreenContext` call `setup` makes synchronously sees `context`, as a
 * descendant of `provideScreenContext` would; so a composable `setup` reaches
 * resolves its context as it is set up, never later in a watcher or callback.
 */
export function runInScreenContext<T>(context: ScreenContext, setup: () => T): T {
	const outer = contextBeingSetUp;
	contextBeingSetUp = context;
	try {
		return setup();
	}
	finally {
		contextBeingSetUp = outer;
	}
}

/**
 * Get the resolved mode config for a given screen mode.
 * Merges stored config with defaults so consumers always get a complete config object.
 */
export function useScreenModeConfig<M extends ScreenMode>(mode: M): ComputedRef<ModeConfigTypeMap[M]> {
	const { screen } = useScreenContext();

	return computed<ModeConfigTypeMap[M]>(() => resolveScreenModeConfig(screen.value?.modeConfigs, mode));
}
