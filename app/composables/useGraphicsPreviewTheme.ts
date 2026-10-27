import type { MaybeRefOrGetter } from 'vue';
import type { GraphicThemeTokens } from '~~/shared/modules/graphics';
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import type { ThemeSummary } from '~~/shared/types/theme';
import { resolveGraphicThemeTokens } from '~~/shared/modules/graphics';
import { DEFAULT_THEME_TOKENS } from '~~/shared/modules/theme';

/** Which Theme a graphics editor previews under: the Event's, the Default Theme, or one by id. */
export const PREVIEW_EVENT_THEME = 'event';
export const PREVIEW_DEFAULT_THEME = 'default';

/**
 * The Theme a graphics editor previews its composition under (#829). A graphic
 * edited on a Screen previews under its Event's Theme; its author may pick any
 * other, or the Default Theme, to see how a template looks under each Theme. The
 * pick is the editor's alone and changes nothing stored.
 *
 * `previewThemeValues` is what the preview frame is told to render under;
 * `themeTokens` is what the editor's own controls show and what detaching copies in.
 */
export function useGraphicsPreviewTheme(eventThemeId: MaybeRefOrGetter<string | null | undefined>) {
	const repository = useThemeRepository();
	const choice = ref<string>(PREVIEW_EVENT_THEME);
	const themes = ref<ThemeSummary[]>([]);
	const loaded = ref<{ id: string; tokens: StoredThemeTokens } | null>(null);

	/** The Theme the choice names, or null for the Default Theme. */
	const themeId = computed(() => {
		if (choice.value === PREVIEW_DEFAULT_THEME)
			return null;
		if (choice.value === PREVIEW_EVENT_THEME)
			return toValue(eventThemeId) ?? null;
		return choice.value;
	});

	onMounted(async () => {
		try {
			themes.value = await repository.list();
		}
		catch {
			// The picker still offers the Event's Theme and the Default Theme.
		}
	});

	watch(themeId, async (id) => {
		if (!id) {
			loaded.value = null;
			return;
		}
		try {
			const theme = await repository.get(id);
			if (themeId.value === id)
				loaded.value = { id, tokens: theme.tokens };
		}
		catch {
			loaded.value = null;
		}
	}, { immediate: true });

	const loadedTokens = computed<StoredThemeTokens | undefined>(() => {
		if (!themeId.value)
			return DEFAULT_THEME_TOKENS;
		return loaded.value?.id === themeId.value
			? loaded.value.tokens
			: undefined;
	});

	/**
	 * What the preview frame is told to render under, or null for the Event's
	 * Theme, which the frame already follows live from its own Event context. A
	 * picked Theme is sent only once loaded, so the frame never flashes another.
	 */
	const previewThemeValues = computed<StoredThemeTokens | null | undefined>(() => choice.value === PREVIEW_EVENT_THEME
		? null
		: loadedTokens.value);

	/** The Foundation Tokens the inspector shows bound properties in, and detaching copies in. */
	const themeTokens = computed<GraphicThemeTokens>(() => resolveGraphicThemeTokens(loadedTokens.value));

	const items = computed(() => [
		{ label: 'Event\'s Theme', value: PREVIEW_EVENT_THEME },
		{ label: 'Default Theme', value: PREVIEW_DEFAULT_THEME },
		...themes.value.map(theme => ({ label: theme.name, value: theme.id })),
	]);

	return {
		choice,
		items,
		previewThemeValues,
		themeTokens,
	};
}
