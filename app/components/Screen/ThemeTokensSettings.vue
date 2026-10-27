<script setup lang="ts">
import type { StoredThemeTokens, ThemeTokenValue } from '~~/shared/modules/theme';
import type { Screen } from '~/types';
import { DEFAULT_THEME_TOKENS, FOUNDATION_TOKENS, readTokenLiteral, resolveThemeTokens } from '~~/shared/modules/theme';
import { screenModeTokens } from '~~/shared/screenModes';
import { parseThemeTokenWrite, themeTokenDefinition } from '~~/shared/themeTokens';

// A Screen's token section: exactly the Theme Tokens its mode consumes, each
// with what it inherits from the Event's Theme and a Screen Theme Override
// control. An override is written per token, and clearing one returns the
// Screen to the Theme's value. What it inherits follows `theme:updated`, as a
// Screen Output does, through the Event store's held Theme.

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

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

async function loadTheme(id: string | null) {
	themeName.value = null;
	themeError.value = null;
	if (!id)
		return;
	await runRequest(() => themes.get(id), {
		latestKey: 'screen-theme',
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

const overrides = computed(() => props.screen.themeOverrides ?? {});
const modeTokens = computed(() => screenModeTokens(props.screen.currentMode));
const resolved = computed(() => resolveThemeTokens({
	vocabulary: FOUNDATION_TOKENS,
	modeTokens: modeTokens.value,
	theme: theme.value,
	overrides: overrides.value,
}));

/** What a token reads with no override: the Theme's stored value where it holds one it may, else the default. */
function inheritedValue(name: string): unknown {
	const stored = theme.value[name];
	if (stored !== undefined && parseThemeTokenWrite(name, stored).ok)
		return stored;
	const { definition } = themeTokenDefinition(name)!;
	return readTokenLiteral(definition, stored) ?? definition.default;
}

const tokens = computed(() => resolved.value.consumed.map(name => ({
	name,
	token: themeTokenDefinition(name)!,
	inherited: inheritedValue(name),
	resolved: resolved.value.values[name] as ThemeTokenValue,
})));
const groups = computed(() => [
	{
		label: 'This mode',
		entries: tokens.value.filter(entry => entry.token.tier === 'mode'),
	},
	{
		label: 'Foundation',
		entries: tokens.value.filter(entry => entry.token.tier === 'foundation'),
	},
]);

const subtitle = computed(() => themeName.value
	? `Inherits from ${themeName.value}. An override applies to this Screen only.`
	: 'Inherits from the Default Theme. An override applies to this Screen only.');

/** Tokens with a write out, so a control does not take a second edit over it. */
const writing = ref(new Set<string>());

async function write(token: string, value: unknown) {
	writing.value = new Set([...writing.value, token]);
	try {
		await runRequest(() => screenStore.updateThemeOverrides(props.eventId, props.screen.id, { [token]: value }), {
			success: false,
			error: failure => ({ title: 'Could not save the override', description: failure.message, color: 'error' }),
		});
	}
	finally {
		const remaining = new Set(writing.value);
		remaining.delete(token);
		writing.value = remaining;
	}
}
</script>

<template>
	<ScreenSettingsCard
		v-if="tokens.length"
		title="Theme"
		:subtitle="subtitle"
		data-testid="screen-theme-tokens"
	>
		<UAlert
			v-if="themeError"
			color="warning"
			variant="soft"
			icon="i-lucide-triangle-alert"
			title="The Event's Theme could not be loaded"
			description="Inherited values are shown as the Default Theme ships them."
		/>
		<template v-for="group in groups" :key="group.label">
			<p class="mt-4 text-xs font-medium uppercase text-muted first:mt-0">
				{{ group.label }}
			</p>
			<ThemeTokenField
				v-for="entry in group.entries"
				:key="entry.name"
				scope="screen"
				:name="entry.name"
				:token="entry.token"
				:stored="overrides[entry.name]"
				:inherited="entry.inherited"
				:resolved="entry.resolved"
				:event-id="eventId"
				:disabled="writing.has(entry.name)"
				@set="value => write(entry.name, value)"
				@clear="write(entry.name, null)"
			/>
		</template>
	</ScreenSettingsCard>
</template>
