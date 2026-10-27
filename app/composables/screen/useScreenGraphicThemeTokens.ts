import type { GraphicThemeTokens } from '~~/shared/modules/graphics';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import { resolveGraphicThemeTokens } from '~~/shared/modules/graphics';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { isGraphicsPreviewThemeMessage } from '~/modules/graphics/previewMessages';

/** What a graphics host resolves its Theme Tokens from. */
export interface ScreenThemeSources {
	/** Its Event's Theme's stored values, or the Theme an editor previews under. */
	theme: StoredThemeTokens;
	/** Its Screen's own Screen Theme Overrides. */
	overrides: StoredThemeTokens;
}

/**
 * The Theme a graphics host renders under: its Event's Theme as the Screen
 * context holds it, with its Screen's own Screen Theme Overrides over it, so a
 * Theme edit, a Theme switch or an override restyles it on air.
 *
 * An editor's embedded preview may be told to preview under another Theme
 * (`GRAPHICS_PREVIEW_THEME_MESSAGE`). Only a preview listens: a live Screen
 * Output installs no listener, so nothing can restyle program from outside.
 */
export function useScreenThemeSources(): ComputedRef<ScreenThemeSources> {
	const { screen, themeTokens, isPreview } = useScreenContext();
	const previewTokens = ref<StoredThemeTokens>();

	function handlePreviewTheme(message: MessageEvent) {
		if (isGraphicsPreviewThemeMessage(message, { origin: window.location.origin, source: window.parent }))
			previewTokens.value = message.data.tokens ?? undefined;
	}

	onMounted(() => {
		if (isPreview?.value)
			window.addEventListener('message', handlePreviewTheme);
	});
	onBeforeUnmount(() => {
		window.removeEventListener('message', handlePreviewTheme);
	});

	return computed(() => ({
		theme: previewTokens.value ?? themeTokens?.value ?? DEFAULT_THEME_TOKENS,
		overrides: screen?.value?.themeOverrides ?? {},
	}));
}

/** The Foundation Tokens a graphics host's bound Graphic Items paint from. */
export function useScreenGraphicThemeTokens(sources: ComputedRef<ScreenThemeSources> = useScreenThemeSources()): ComputedRef<GraphicThemeTokens> {
	return computed(() => resolveGraphicThemeTokens(sources.value.theme, sources.value.overrides));
}
