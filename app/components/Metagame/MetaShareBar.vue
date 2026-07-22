<script setup lang="ts">
defineProps<{
	value: number;
	max: number;
}>();
</script>

<template>
	<div class="flex items-center gap-2 min-w-32">
		<div class="flex-1 h-1.5 rounded-full bg-elevated overflow-hidden">
			<div
				class="h-full rounded-full bg-info transition-all"
				:style="{ width: `${max > 0 ? (value / max) * 100 : 0}%` }"
			/>
		</div>
		<span class="text-xs tabular-nums shrink-0 w-12 text-right">
			{{ formatPercent(value) }}
		</span>
	</div>
</template>
