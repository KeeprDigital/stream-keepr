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
 * other, or the Default Theme, to see how a template looks in each brand. The
 * pick is the editor's alone and changes nothing stored.
 *
 * `storedTokens` is what the preview frame renders; `themeTokens` is what the
 * editor's own controls show and what detaching copies in.
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

	const storedTokens = computed<StoredThemeTokens>(() => themeId.value && loaded.value?.id === themeId.value
		? loaded.value.tokens
		: DEFAULT_THEME_TOKENS);

	const themeTokens = computed<GraphicThemeTokens>(() => resolveGraphicThemeTokens(storedTokens.value));

	const items = computed(() => [
		{ label: 'Event\'s Theme', value: PREVIEW_EVENT_THEME },
		{ label: 'Default Theme', value: PREVIEW_DEFAULT_THEME },
		...themes.value.map(theme => ({ label: theme.name, value: theme.id })),
	]);

	return {
		choice,
		items,
		storedTokens,
		themeTokens,
	};
}
