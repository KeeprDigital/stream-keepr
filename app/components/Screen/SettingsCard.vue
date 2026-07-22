<script setup lang="ts">
const props = withDefaults(defineProps<{
	title: string;
	subtitle?: string;
	collapsible?: boolean;
	defaultOpen?: boolean;
}>(), {
	collapsible: true,
	defaultOpen: true,
});

const open = ref(props.defaultOpen);

function toggleOpen() {
	if (props.collapsible)
		open.value = !open.value;
}
</script>

<template>
	<UCard v-if="open" variant="subtle">
		<template #header>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 class="font-semibold">
						{{ title }}
					</h3>
					<p v-if="subtitle" class="text-sm text-muted">
						{{ subtitle }}
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<slot name="actions" :open="open" />
					<UButton
						v-if="collapsible"
						color="neutral"
						variant="ghost"
						icon="i-lucide-chevron-up"
						:aria-label="`Collapse ${title}`"
						@click="toggleOpen"
					/>
				</div>
			</div>
		</template>

		<div class="w-full flex flex-col gap-4">
			<slot />
		</div>
	</UCard>

	<UCard v-else variant="subtle">
		<template #header>
			<div class="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 class="font-semibold">
						{{ title }}
					</h3>
					<p v-if="subtitle" class="text-sm text-muted">
						{{ subtitle }}
					</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<slot name="actions" :open="open" />
					<UButton
						v-if="collapsible"
						color="neutral"
						variant="ghost"
						icon="i-lucide-chevron-down"
						:aria-label="`Expand ${title}`"
						@click="toggleOpen"
					/>
				</div>
			</div>
		</template>
	</UCard>
</template>
