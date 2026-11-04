import type { MaybeRefOrGetter } from 'vue';
import type { StoredThemeTokens, ThemeTokenValue } from '~~/shared/modules/theme';
import type { ThemeTokenDefinitionOf } from '~~/shared/themeTokens';
import type { ThemeResponse } from '~~/shared/types/theme';
import type { Screen } from '~/types';
import { DEFAULT_THEME_TOKENS, FOUNDATION_TOKENS, readTokenLiteral, resolveFoundationToken, resolveThemeTokens } from '~~/shared/modules/theme';
import { screenModeHostTokens } from '~~/shared/screenModeDefinitions';
import { screenModeTokens } from '~~/shared/screenModes';
import { parseThemeTokenWrite, themeTokenDefinition } from '~~/shared/themeTokens';

/** One Theme Token as a Screen's settings page shows it. */
export interface ScreenThemeTokenEntry {
	name: string;
	token: ThemeTokenDefinitionOf;
	/** The Screen Theme Override, if one is stored. */
	stored: unknown;
	/** What it reads with no override, as stored: a literal, or a Foundation Token it follows. */
	inherited: unknown;
	/** What the Screen renders now. */
	resolved: ThemeTokenValue;
}

/**
 * Theme reads in flight, by Theme id, so the row groups of one settings page
 * mounting together read the Event's Theme once. Each entry leaves on settling.
 */
const themeReads = new Map<string, Promise<ThemeResponse>>();

function readThemeOnce(id: string, read: (id: string) => Promise<ThemeResponse>): Promise<ThemeResponse> {
	const inFlight = themeReads.get(id);
	if (inFlight)
		return inFlight;
	const reading = read(id).finally(() => themeReads.delete(id));
	themeReads.set(id, reading);
	return reading;
}

/**
 * A Screen's Screen Theme Overrides as its settings page edits them (ADR-0049):
 * the Event's Theme each token inherits from, each token's resolution, and the
 * per-token write and Clear. What a token inherits follows `theme:updated`, as
 * a Screen Output does, through the Event store's held Theme. Rows only ever
 * write an override, never mode config (ADR-0051).
 */
export function useScreenThemeOverrides(screen: MaybeRefOrGetter<Screen>, eventId: MaybeRefOrGetter<number>) {
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
		await runRequest(() => readThemeOnce(id, themes.get), {
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

	const overrides = computed<StoredThemeTokens>(() => toValue(screen).themeOverrides ?? {});
	const resolved = computed(() => {
		const mode = toValue(screen).currentMode;
		return resolveThemeTokens({
			vocabulary: FOUNDATION_TOKENS,
			modeTokens: screenModeTokens(mode),
			theme: theme.value,
			overrides: overrides.value,
			hostTokens: screenModeHostTokens(mode),
		});
	});

	/** What a token reads with no override: the Theme's stored value where it holds one it may, else the default. */
	function inheritedValue(name: string): unknown {
		const stored = theme.value[name];
		if (stored !== undefined && parseThemeTokenWrite(name, stored).ok)
			return stored;
		const { definition } = themeTokenDefinition(name)!;
		return readTokenLiteral(definition, stored) ?? definition.default;
	}

	function entry(name: string): ScreenThemeTokenEntry {
		return {
			name,
			token: themeTokenDefinition(name)!,
			stored: overrides.value[name],
			inherited: inheritedValue(name),
			// A Mode Token may resolve to null, as an unset `asset` does, so ask whether it resolved at all.
			resolved: (Object.hasOwn(resolved.value.values, name)
				? resolved.value.values[name]
				: resolveFoundationToken({ vocabulary: FOUNDATION_TOKENS, theme: theme.value, overrides: overrides.value }, name)) as ThemeTokenValue,
		};
	}

	/** Tokens with a write out, so a control does not take a second edit over it. */
	const writing = ref(new Set<string>());

	async function write(name: string, value: unknown) {
		writing.value = new Set([...writing.value, name]);
		try {
			await runRequest(() => screenStore.updateThemeOverrides(toValue(eventId), toValue(screen).id, { [name]: value }), {
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

	return {
		themeName: readonly(themeName),
		themeError: readonly(themeError),
		overrides,
		entry,
		writing: readonly(writing),
		set: write,
		/** Clear the override, returning the Screen to the Theme's value. */
		clear: (name: string) => write(name, null),
	};
}
