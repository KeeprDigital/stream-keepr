<script setup lang="ts">
import type { ThemeTokenValue } from '~~/shared/modules/theme';
import type { ThemeResponse } from '~~/shared/types/theme';
import { FOUNDATION_TOKENS, readTokenLiteral, resolveThemeTokens } from '~~/shared/modules/theme';
import { THEMED_SCREEN_MODE_TOKENS, themeTokenDefinition } from '~~/shared/themeTokens';

definePageMeta({
	title: 'Theme',
});

const route = useRoute();
const repository = useThemeRepository();
const { runRequest } = useRequestFeedback();

const themeId = computed(() => String(route.params.themeId));
const theme = ref<ThemeResponse | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const name = ref('');
const renaming = ref(false);
/** Tokens with a write in flight, so a control does not take a second edit over it. */
const writing = ref(new Set<string>());

/**
 * Hold a Theme a read or write answered. Each token write answers the whole
 * Theme at its revision, so an answer older than the one held — another write
 * that landed first, a colleague's included — is not applied over it.
 */
function hold(answered: ThemeResponse) {
	if (theme.value && theme.value.id === answered.id && theme.value.revision > answered.revision)
		return;
	theme.value = answered;
}

async function load() {
	await runRequest(() => repository.get(themeId.value), {
		loadingRef: loading,
		errorRef: loadError,
		error: false,
		onSuccess: (loaded) => {
			theme.value = loaded;
			name.value = loaded.name;
		},
	});
}

async function rename() {
	const next = name.value.trim();
	if (!theme.value || !next || next === theme.value.name) {
		name.value = theme.value?.name ?? '';
		return;
	}
	await runRequest(() => repository.rename(themeId.value, next), {
		loadingRef: renaming,
		success: false,
		error: failure => ({ title: 'Could not rename the Theme', description: failure.message, color: 'error' }),
		onSuccess: (renamed) => {
			if (theme.value)
				theme.value = { ...theme.value, name: renamed.name };
			name.value = renamed.name;
		},
		onFailure: () => {
			name.value = theme.value?.name ?? '';
		},
	});
}

async function write(token: string, request: () => Promise<ThemeResponse>) {
	writing.value = new Set([...writing.value, token]);
	try {
		await runRequest(request, {
			success: false,
			error: failure => ({ title: 'Could not save the token', description: failure.message, color: 'error' }),
			onSuccess: hold,
		});
	}
	finally {
		const remaining = new Set(writing.value);
		remaining.delete(token);
		writing.value = remaining;
	}
}

function setToken(token: string, value: unknown) {
	return write(token, () => repository.setToken(themeId.value, token, value));
}

function clearToken(token: string) {
	return write(token, () => repository.clearToken(themeId.value, token));
}

const stored = computed(() => theme.value?.tokens ?? {});

const foundationTokens = computed(() => Object.entries(FOUNDATION_TOKENS).map(([token, definition]) => ({
	name: token,
	token: themeTokenDefinition(token)!,
	resolved: (readTokenLiteral(definition, stored.value[token]) ?? definition.default) as ThemeTokenValue,
})));

const modeGroups = computed(() => THEMED_SCREEN_MODE_TOKENS.map((group) => {
	const { values } = resolveThemeTokens({
		vocabulary: FOUNDATION_TOKENS,
		modeTokens: group.tokens,
		theme: stored.value,
		overrides: {},
	});
	return {
		mode: group.mode,
		label: group.label,
		tokens: Object.keys(group.tokens).map(token => ({
			name: token,
			token: themeTokenDefinition(token)!,
			resolved: values[token]!,
		})),
	};
}));

onMounted(load);
watch(themeId, load);
</script>

<template>
	<NuxtLayout name="default">
		<div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<div class="flex flex-col gap-3">
				<UButton
					to="/themes"
					variant="link"
					color="neutral"
					icon="i-lucide-arrow-left"
					class="self-start px-0"
				>
					Themes
				</UButton>
				<UFormField v-if="theme" name="name" label="Theme name">
					<UInput
						v-model="name"
						size="lg"
						class="w-full max-w-md"
						maxlength="100"
						:loading="renaming"
						@blur="rename"
						@keydown.enter.prevent="rename"
					/>
				</UFormField>
				<p class="text-sm text-muted">
					Every edit is live: it restyles every Screen Output of every Event using this Theme
					at once. A token left unset follows its default, so it reads as the Default Theme does.
				</p>
			</div>

			<UAlert
				v-if="loadError"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="This Theme could not be loaded"
				:description="loadError"
			/>

			<template v-if="theme">
				<UCard>
					<template #header>
						<h2 class="font-semibold text-highlighted">
							Foundation Tokens
						</h2>
						<p class="text-xs text-muted">
							Roles every Screen Mode may use.
						</p>
					</template>
					<ThemeTokenField
						v-for="entry in foundationTokens"
						:key="entry.name"
						:name="entry.name"
						:token="entry.token"
						:stored="stored[entry.name]"
						:resolved="entry.resolved"
						:disabled="writing.has(entry.name)"
						@set="value => setToken(entry.name, value)"
						@clear="clearToken(entry.name)"
					/>
				</UCard>

				<UCard v-for="group in modeGroups" :key="group.mode" :data-mode-tokens="group.mode">
					<template #header>
						<h2 class="font-semibold text-highlighted">
							{{ group.label }}
						</h2>
						<p class="text-xs text-muted">
							How this Screen Mode looks. Each token follows a Foundation Token unless given its own value.
						</p>
					</template>
					<ThemeTokenField
						v-for="entry in group.tokens"
						:key="entry.name"
						:name="entry.name"
						:token="entry.token"
						:stored="stored[entry.name]"
						:resolved="entry.resolved"
						:disabled="writing.has(entry.name)"
						@set="value => setToken(entry.name, value)"
						@clear="clearToken(entry.name)"
					/>
				</UCard>
			</template>
		</div>
	</NuxtLayout>
</template>
