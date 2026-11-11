import type { InjectionKey, MaybeRefOrGetter } from 'vue';
import type { StoredThemeTokens, ThemeTokenValue } from '~~/shared/modules/theme';
import type { ThemeTokenDefinitionOf } from '~~/shared/themeTokens';
import type { Screen } from '~/types';
import { DEFAULT_THEME_TOKENS, FOUNDATION_TOKENS, resolveFoundationToken, resolveThemeTokens } from '~~/shared/modules/theme';
import { screenModeHostTokens } from '~~/shared/screenModeDefinitions';
import { screenModeTokens } from '~~/shared/screenModes';
import { themeTokenDefinition } from '~~/shared/themeTokens';
import { screenBackgroundLayers } from '~/modules/screen-mode/modeTokens';

/** One Theme Token as a Screen's settings page shows it. */
export interface ScreenThemeTokenEntry {
	name: string;
	token: ThemeTokenDefinitionOf;
	/** The Screen Theme Override, if one is stored. */
	stored: unknown;
	/**
	 * What it reads with no override: a Foundation Token's Theme value as it
	 * resolves, else its default as declared, which may name a Foundation Token.
	 * A Mode Token's is always its default: a Theme stores Foundation Tokens only.
	 */
	inherited: unknown;
	/** What the Screen renders now. */
	resolved: ThemeTokenValue;
}

/**
 * A Screen's Screen Theme Overrides as its settings page edits them (ADR-0049):
 * the Event's Theme each token inherits from, each token's resolution, and the
 * per-token write and Clear. What a token inherits follows `theme:updated`, as
 * a Screen Output does, through the Event store's held Theme. Rows only ever
 * write an override, never mode config (ADR-0051).
 *
 * `screen` is absent while the page loads it: nothing is overridden, and
 * nothing is written, until it arrives.
 */
function createScreenThemeOverrides(screen: MaybeRefOrGetter<Screen | null | undefined>, eventId: MaybeRefOrGetter<number>) {
	const eventStore = useEventStore();
	const screenStore = useScreenStore();
	const themes = useThemeRepository();
	const { runRequest } = useRequestFeedback();

	const themeId = computed(() => eventStore.event?.themeId ?? null);
	const theme = computed<StoredThemeTokens>(() => themeId.value && eventStore.eventTheme?.id === themeId.value
		? eventStore.eventTheme.tokens
		: DEFAULT_THEME_TOKENS);
	const themeName = ref<string | null>(null);
	const themeError = ref<string | null>(null);
	const latestKey = Symbol('screen-theme');

	async function loadTheme(id: string | null) {
		themeName.value = null;
		themeError.value = null;
		if (!id)
			return;
		await runRequest(() => themes.get(id), {
			latestKey,
			errorRef: themeError,
			success: false,
			error: false,
			onSuccess: (loaded) => {
				eventStore.holdEventTheme({ id: loaded.id, revision: loaded.revision, tokens: loaded.tokens });
				themeName.value = loaded.name;
			},
		});
	}

	watch(themeId, id => void loadTheme(id), { immediate: true });

	const overrides = computed<StoredThemeTokens>(() => toValue(screen)?.themeOverrides ?? {});
	function resolveWith(stored: StoredThemeTokens) {
		const mode = toValue(screen)?.currentMode;
		return resolveThemeTokens({
			vocabulary: FOUNDATION_TOKENS,
			modeTokens: mode
				? screenModeTokens(mode)
				: {},
			theme: theme.value,
			overrides: stored,
			hostTokens: mode
				? screenModeHostTokens(mode)
				: [],
		});
	}
	const resolved = computed(() => resolveWith(overrides.value));

	/** The Screen's tokens as they resolve with no override: what its Theme alone gives it. */
	const themed = computed(() => resolveWith({}));

	function resolvedIn(values: Readonly<Record<string, ThemeTokenValue>>, name: string, stored: StoredThemeTokens): ThemeTokenValue {
		// A Mode Token may resolve to null, as an unset `asset` does, so ask whether it resolved at all.
		return (Object.hasOwn(values, name)
			? values[name]
			: resolveFoundationToken({ vocabulary: FOUNDATION_TOKENS, theme: theme.value, overrides: stored }, name)) as ThemeTokenValue;
	}

	/**
	 * What a token reads with no override: the value its Theme gives a
	 * Foundation Token, as it resolves, where the Theme stores one, else its
	 * default as declared.
	 */
	function inheritedValue(name: string): unknown {
		const token = themeTokenDefinition(name)!;
		return token.tier === 'mode' || theme.value[name] === undefined
			? token.definition.default
			: resolvedIn(themed.value.values, name, {});
	}

	function entry(name: string): ScreenThemeTokenEntry {
		return {
			name,
			token: themeTokenDefinition(name)!,
			stored: overrides.value[name],
			inherited: inheritedValue(name),
			resolved: resolvedIn(resolved.value.values, name, overrides.value),
		};
	}

	/** Tokens with a write out, so a control does not take a second edit over it. */
	const writing = ref(new Set<string>());

	async function write(name: string, value: unknown) {
		const edited = toValue(screen);
		if (!edited)
			return;
		writing.value = new Set([...writing.value, name]);
		try {
			await runRequest(() => screenStore.updateThemeOverrides(toValue(eventId), edited.id, { [name]: value }), {
				success: false,
				error: failure => ({ title: 'Could not save the override', description: failure.message, color: 'error' }),
			});
		}
		finally {
			const remaining = new Set(writing.value);
			remaining.delete(name);
			writing.value = remaining;
		}
	}

	/** The Theme's `background` stack as it resolves, every colour a literal: what a Screen holding no stack of its own paints. */
	const themeBackground = computed(() => screenBackgroundLayers(undefined, theme.value));

	return {
		themeName: readonly(themeName),
		themeBackground,
		themeError: readonly(themeError),
		overrides,
		entry,
		writing: readonly(writing),
		set: write,
		/** Clear the override, returning the Screen to what the token inherits. */
		clear: (name: string) => write(name, null),
	};
}

/** A Screen's Screen Theme Overrides, as every card of its settings page reads and writes them. */
export type ScreenThemeOverrides = ReturnType<typeof createScreenThemeOverrides>;

const SCREEN_THEME_OVERRIDES_KEY: InjectionKey<ScreenThemeOverrides> = Symbol('screen-theme-overrides');

/**
 * Hold the Screen's Screen Theme Overrides and its one read of the Event's
 * Theme, for every card below. Called once, by the Screen's settings page.
 */
export function provideScreenThemeOverrides(screen: MaybeRefOrGetter<Screen | null | undefined>, eventId: MaybeRefOrGetter<number>): ScreenThemeOverrides {
	const overrides = createScreenThemeOverrides(screen, eventId);
	provide(SCREEN_THEME_OVERRIDES_KEY, overrides);
	return overrides;
}

/** The Screen Theme Overrides the Screen's settings page holds. Throws outside that page. */
export function useScreenThemeOverrides(): ScreenThemeOverrides {
	const overrides = inject(SCREEN_THEME_OVERRIDES_KEY);
	if (!overrides) {
		throw new Error(
			'useScreenThemeOverrides() was called outside a Screen settings page. '
			+ 'Ensure provideScreenThemeOverrides() is called by an ancestor component.',
		);
	}
	return overrides;
}
