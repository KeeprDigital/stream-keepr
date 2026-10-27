<script setup lang="ts">
import type { ThemeSummary } from '~~/shared/types/theme';

definePageMeta({
	title: 'Themes',
});

const repository = useThemeRepository();
const { runRequest } = useRequestFeedback();

const themes = ref<ThemeSummary[] | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const creating = ref(false);
const newName = ref('');
const deleting = ref<string | null>(null);

async function load() {
	await runRequest(() => repository.list(), {
		loadingRef: loading,
		errorRef: loadError,
		error: false,
		onSuccess: (listed) => {
			themes.value = listed;
		},
	});
}

async function create() {
	const name = newName.value.trim();
	if (!name || creating.value)
		return;
	await runRequest(() => repository.create(name), {
		loadingRef: creating,
		success: false,
		error: failure => ({ title: 'Could not create the Theme', description: failure.message, color: 'error' }),
		onSuccess: async (theme) => {
			newName.value = '';
			await navigateTo(`/themes/${theme.id}`);
		},
	});
}

async function remove(theme: ThemeSummary) {
	deleting.value = theme.id;
	try {
		await runRequest(async () => {
			await repository.remove(theme.id);
			return true;
		}, {
			success: { title: 'Theme deleted', description: theme.name, color: 'success' },
			error: failure => ({ title: 'Could not delete the Theme', description: failure.message, color: 'error' }),
			onSuccess: () => {
				themes.value = themes.value?.filter(listed => listed.id !== theme.id) ?? null;
			},
		});
	}
	finally {
		deleting.value = null;
	}
}

onMounted(load);
</script>

<template>
	<NuxtLayout name="default">
		<div class="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<div>
				<h1 class="text-2xl font-semibold text-highlighted">
					Themes
				</h1>
				<p class="mt-1 text-sm text-muted">
					A Theme gives every Screen of an Event one look. Pick one for an Event in its
					Broadcast settings. Edits reach every Screen Output using the Theme at once.
				</p>
			</div>

			<UCard>
				<UForm :state="{ newName }" class="flex flex-wrap items-end gap-3" @submit="create">
					<UFormField name="newName" label="New Theme" class="grow">
						<UInput
							v-model="newName"
							placeholder="Theme name"
							class="w-full"
							maxlength="100"
						/>
					</UFormField>
					<UButton
						type="submit"
						icon="i-lucide-plus"
						:loading="creating"
						:disabled="!newName.trim()"
					>
						Create
					</UButton>
				</UForm>
			</UCard>

			<UAlert
				v-if="loadError"
				color="error"
				variant="soft"
				icon="i-lucide-triangle-alert"
				title="Themes could not be loaded"
				:description="loadError"
			/>

			<UCard :ui="{ body: 'p-0 sm:p-0' }">
				<ul class="divide-y divide-default" aria-label="Theme library">
					<li class="flex items-center justify-between gap-4 px-4 py-3" data-theme="default">
						<div>
							<p class="font-medium text-highlighted">
								Default Theme
							</p>
							<p class="text-xs text-muted">
								Built in and read-only. Used by every Event that picks no Theme.
							</p>
						</div>
						<UBadge color="neutral" variant="subtle" label="Built in" />
					</li>
					<li
						v-for="theme in themes ?? []"
						:key="theme.id"
						class="flex items-center justify-between gap-4 px-4 py-3"
						:data-theme="theme.id"
					>
						<NuxtLink :to="`/themes/${theme.id}`" class="font-medium text-highlighted hover:underline">
							{{ theme.name }}
						</NuxtLink>
						<div class="flex items-center gap-2">
							<UButton
								:to="`/themes/${theme.id}`"
								size="sm"
								color="neutral"
								variant="outline"
								icon="i-lucide-pencil"
							>
								Edit
							</UButton>
							<UButton
								size="sm"
								color="error"
								variant="ghost"
								icon="i-lucide-trash-2"
								:loading="deleting === theme.id"
								:aria-label="`Delete ${theme.name}`"
								@click="remove(theme)"
							>
								Delete
							</UButton>
						</div>
					</li>
					<li v-if="loading && !themes" class="px-4 py-3 text-sm text-muted">
						Loading…
					</li>
				</ul>
			</UCard>
		</div>
	</NuxtLayout>
</template>
