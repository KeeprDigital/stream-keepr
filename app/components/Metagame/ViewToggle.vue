<script setup lang="ts">
export type MetagameAdminView = 'table' | 'bar';

defineProps<{
	modelValue: MetagameAdminView;
	/** Hide chart options (used for sections that only support table view) */
	tableOnly?: boolean;
}>();

const emit = defineEmits<{
	(e: 'update:modelValue', value: MetagameAdminView): void;
}>();

const options: Array<{ value: MetagameAdminView; icon: string; label: string }> = [
	{ value: 'table', icon: 'i-lucide-table-2', label: 'Table' },
	{ value: 'bar', icon: 'i-lucide-bar-chart-horizontal-big', label: 'Bar chart' },
];
</script>

<template>
	<UFieldGroup size="xs">
		<template v-for="option in options" :key="option.value">
			<UTooltip
				v-if="!tableOnly || option.value === 'table'"
				:text="option.label"
			>
				<UButton
					:icon="option.icon"
					:label="option.label"
					:variant="modelValue === option.value ? 'soft' : 'outline'"
					:color="modelValue === option.value ? 'primary' : 'neutral'"
					@click="emit('update:modelValue', option.value)"
				/>
			</UTooltip>
		</template>
	</UFieldGroup>
</template>
