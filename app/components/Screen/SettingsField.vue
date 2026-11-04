<script setup lang="ts">
/**
 * The inline layout of one Screen settings control: label and description on
 * the left, the control on the right, stacked on a narrow screen. Every
 * declared field renders through `ScreenConfigField`, which uses it; a bespoke
 * control (an Event Reference picker, a nine-point picker) uses it directly.
 */
defineProps<{
	label: string;
	description?: string;
}>();
</script>

<template>
	<UFormField
		:label="label"
		:description="description"
		class="flex max-sm:flex-col justify-between items-start gap-4"
	>
		<slot />
	</UFormField>
</template>
