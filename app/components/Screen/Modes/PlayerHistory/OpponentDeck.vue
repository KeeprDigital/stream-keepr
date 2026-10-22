<script setup lang="ts">
/** A history row's opponent deck: its name, with its mana colours when known. */
defineProps<{
	name: string;
	colors: string | null;
}>();
</script>

<template>
	{{ name }}
	<MtgManaColorDisplay
		v-if="colors"
		:colors="colors"
		size="sm"
		class="inline-flex ml-2 align-middle"
	/>
</template>
