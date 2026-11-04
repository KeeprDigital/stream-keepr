import type { InjectionKey, Ref } from 'vue';
import type { EventCanvas } from '~~/shared/eventCanvas';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { Game, ScreenMode } from '~~/shared/types/enums';
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
	/**
	 * Resolve a Feature Match Overlay against the Feature Match Stress Dataset, over
	 * any bound Feature Match Slot, in embedded previews only.
	 */
	previewStressDataset?: Ref<boolean>;
	/** Opaque capability supplied to an unattended Screen Output via its URL fragment. */
	assetCapability?: Ref<string | null>;
	/**
	 * Where the rendering self-reports whether it resolved all its card data.
	 * Owned by the host so it can carry the report to control surfaces (via
	 * presence, like `assetAccess`) instead of showing it on program (#465).
	 */
	cardDataHealth?: Ref<ScreenCardDataHealth>;
	/**
	 * The stored token values of the Theme the Screen's Event uses. Absent, or
	 * undefined, renders the Default Theme.
	 */
	themeTokens?: Ref<StoredThemeTokens | undefined>;
	/**
	 * The Event Canvas the Screen renders in (ADR-0051). Absent renders the
	 * default canvas.
	 */
	eventCanvas?: Ref<EventCanvas>;
	/**
	 * Every read answers from this Card Game's Screen Mode Sample Dataset rather
	 * than the Screen. Set only by a Theme preview (`createScreenModeSampleContext`);
	 * a Screen Output never sets it, so sample data never reaches air.
	 */
	sampleDataset?: Game;
	/** The space the Screen renders into; absent means the browser window. */
	viewport?: Readonly<Ref<{ width: number; height: number }>>;
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
 *
 * A Screen Mode's data composable never calls this: it takes its context as
 * an argument, which a rendering injects here and a mode's settings editor
 * builds for the Screen it edits (`useEditedScreenModeData`), so the editor
 * reads what its renderings read (#780, #914).
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
export function useScreenModeConfig<M extends ScreenMode>(context: ScreenContext, mode: M): ComputedRef<ModeConfigTypeMap[M]> {
	const { screen } = context;

	return computed<ModeConfigTypeMap[M]>(() => resolveScreenModeConfig(screen.value?.modeConfigs, mode));
}

/**
 * The Card Game a Screen renders for: a Theme preview's sample's, or else its
 * Event's. Unknown until the Event context loads.
 */
export function useScreenCardGame(context: ScreenContext): ComputedRef<Game | undefined> {
	const eventStore = useEventStore();
	return computed(() => context.sampleDataset ?? eventStore.displayEvent?.game);
}
