import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';
import { screenLayoutTokens } from '~/modules/screen-mode';

/**
 * The Screen inset a plain mode's host pads its Event Canvas by: the Screen's
 * override, else its Event's Theme, else the default. A display sizing its
 * rows to the space inside the inset reads it here.
 */
export function useScreenInset() {
	const { screen, themeTokens } = useScreenContext();
	return computed(() => screenLayoutTokens(themeTokens?.value ?? DEFAULT_THEME_TOKENS, screen.value?.themeOverrides ?? {}).inset);
}
