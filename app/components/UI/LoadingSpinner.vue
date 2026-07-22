<script setup lang="ts">
withDefaults(defineProps<{
	size?: 'sm' | 'md';
	fill?: boolean;
	label?: string;
}>(), {
	size: 'md',
	fill: false,
});
</script>

<template>
	<div
		class="flex items-center justify-center"
		:class="fill ? 'h-full' : 'py-12'"
	>
		<UIcon
			name="i-lucide-loader-2"
			class="animate-spin text-primary"
			:class="size === 'sm' ? 'text-2xl' : 'h-8 w-8'"
		/>
		<span v-if="label" class="ml-2 text-muted">{{ label }}</span>
	</div>
</template>
