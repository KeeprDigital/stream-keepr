import type { GraphicThemeTokens } from '~~/shared/modules/graphics';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import { resolveGraphicThemeTokens } from '~~/shared/modules/graphics';
import { isGraphicsPreviewThemeMessage } from '~/modules/graphics/previewMessages';

/**
 * The Foundation Tokens a graphics host's bound Graphic Items paint from: its
 * Event's Theme as the Screen context holds it, so a Theme edit or switch
 * restyles them on air. The Screen carries no Screen Theme Overrides yet.
 *
 * An editor's embedded preview may be told to preview under another Theme
 * (`GRAPHICS_PREVIEW_THEME_MESSAGE`). Only a preview listens: a live Screen
 * Output installs no listener, so nothing can restyle program from outside.
 */
export function useScreenGraphicThemeTokens(): ComputedRef<GraphicThemeTokens> {
	const { themeTokens, isPreview } = useScreenContext();
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

	return computed(() => resolveGraphicThemeTokens(previewTokens.value ?? themeTokens?.value, {}));
}
