<script setup lang="ts">
withDefaults(defineProps<{
	placeholder?: string;
	ariaLabel?: string;
}>(), {
	placeholder: 'Search…',
	ariaLabel: 'Search',
});

const model = defineModel<string>({ default: '' });
</script>

<template>
	<UInput
		v-model="model"
		leading-icon="i-lucide-search"
		:placeholder="placeholder"
		:aria-label="ariaLabel"
		size="sm"
	>
		<template #trailing>
			<UButton
				v-if="model !== ''"
				color="neutral"
				variant="link"
				icon="i-lucide-x"
				:padded="false"
				aria-label="Clear search"
				@click="() => { model = '' }"
			/>
		</template>
	</UInput>
</template>
