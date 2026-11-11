<script setup lang="ts">
import type { FoundationTokenKind } from '~~/shared/modules/theme';
import type { ThemeResponse } from '~~/shared/types/theme';
import { FOUNDATION_TOKEN_KIND, FOUNDATION_TOKEN_KINDS, FOUNDATION_TOKENS, resolveFoundationTokens } from '~~/shared/modules/theme';
import { themeTokenDefinition } from '~~/shared/themeTokens';

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
/** Tokens with a write in flight, or waiting behind one. */
const writing = ref(new Set<string>());
/** The newest write waiting behind each token's write in flight; a newer one replaces it. */
const waiting = new Map<string, () => Promise<ThemeResponse>>();

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

/**
 * Write one token, one request at a time. Each request carries the token's
 * whole value, or clears it, so a request made while one is out waits for its
 * answer and only the newest waiting one is sent: the Theme ends at the last
 * edit, whichever order the network would have delivered them in.
 */
async function write(token: string, request: () => Promise<ThemeResponse>) {
	if (writing.value.has(token)) {
		waiting.set(token, request);
		return;
	}
	writing.value = new Set([...writing.value, token]);
	try {
		for (let next: typeof request | undefined = request; next; next = waiting.get(token)) {
			waiting.delete(token);
			await runRequest(next, {
				success: false,
				error: failure => ({ title: 'Could not save the token', description: failure.message, color: 'error' }),
				onSuccess: hold,
			});
		}
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

const KINDS: Record<FoundationTokenKind, { title: string; description: string }> = {
	colours: { title: 'Colours', description: 'Surfaces, text, accents and states.' },
	type: { title: 'Type', description: 'The heading and body fonts.' },
	motion: { title: 'Motion', description: 'How content enters, updates and leaves.' },
	surfaces: { title: 'Surfaces', description: 'The accent fill, and the panel raised content sits on.' },
	background: { title: 'Background & placement', description: 'What paints behind a Screen\'s content, and where that content sits.' },
	assets: { title: 'Assets', description: 'Library content a Screen shows.' },
	chart: { title: 'Chart', description: 'The colour of each chart series.' },
};

// Each Foundation Token as the Theme resolves it, every colour a literal: what its field edits and an edit writes.
// A Theme stores nothing else: a Mode Token is set per Screen.
const tokenKinds = computed(() => {
	const values = resolveFoundationTokens({ vocabulary: FOUNDATION_TOKENS, theme: stored.value, overrides: {} });
	const tokens = Object.keys(FOUNDATION_TOKENS) as (keyof typeof FOUNDATION_TOKENS)[];
	return FOUNDATION_TOKEN_KINDS.map(kind => ({
		kind,
		...KINDS[kind],
		tokens: tokens.filter(token => FOUNDATION_TOKEN_KIND[token] === kind).map(token => ({
			name: token,
			token: themeTokenDefinition(token)!,
			resolved: values[token]!,
		})),
	}));
});

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
					What belongs to one Screen Mode alone is set on each Screen.
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
							Preview
						</h2>
						<p class="text-xs text-muted">
							Every themed Screen Mode, shown with sample data. It is never shown on air.
						</p>
					</template>
					<ThemePreviewGallery :tokens="stored" />
				</UCard>

				<UCard v-for="group in tokenKinds" :key="group.kind" :data-token-kind="group.kind">
					<template #header>
						<h2 class="font-semibold text-highlighted">
							{{ group.title }}
						</h2>
						<p class="text-xs text-muted">
							{{ group.description }}
						</p>
					</template>
					<ThemeTokenField
						v-for="entry in group.tokens"
						:key="entry.name"
						:name="entry.name"
						:token="entry.token"
						:stored="stored[entry.name]"
						:resolved="entry.resolved"
						:writing="writing.has(entry.name)"
						@set="value => setToken(entry.name, value)"
						@clear="clearToken(entry.name)"
					/>
				</UCard>
			</template>
		</div>
	</NuxtLayout>
</template>
