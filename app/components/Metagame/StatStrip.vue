<script setup lang="ts">
defineProps<{
	stats: Array<{
		label: string;
		value: string | number | null;
	}>;
}>();
</script>

<template>
	<div class="flex flex-wrap gap-x-8 gap-y-3">
		<div
			v-for="stat in stats"
			:key="stat.label"
			class="flex flex-col gap-0.5"
		>
			<span class="text-xs text-muted uppercase tracking-wide font-medium">{{ stat.label }}</span>
			<span class="text-2xl font-semibold tabular-nums">{{ stat.value ?? '-' }}</span>
		</div>
	</div>
</template>
