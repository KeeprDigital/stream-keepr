<script setup lang="ts">
import type { MetagameConversionMetric } from '~~/shared/types/enums';

const props = defineProps<{
	conversionMetric: MetagameConversionMetric;
	conversionThreshold: number;
}>();

const emit = defineEmits<{
	(e: 'update:conversionMetric', metric: MetagameConversionMetric): void;
	(e: 'update:conversionThreshold', threshold: number): void;
}>();

const TOP_N_PRESETS = [8, 16, 32];

const conversionItems = computed(() => [
	...TOP_N_PRESETS.map(n => ({ label: `Top ${n}`, value: `topN:${n}` })),
	{ label: 'Top N…', value: 'topN' },
	{ label: 'Minimum Points…', value: 'minPoints' },
]);

// A preset Top N and a custom Top N are the same target underneath; this only
// remembers which face of it the operator picked, so typing a preset value
// into the custom input does not collapse the input away.
const customTopN = ref(false);

const currentValue = computed(() => {
	if (props.conversionMetric === 'minPoints')
		return 'minPoints';
	return !customTopN.value && TOP_N_PRESETS.includes(props.conversionThreshold)
		? `topN:${props.conversionThreshold}`
		: 'topN';
});

const showThresholdInput = computed(() => currentValue.value === 'topN' || currentValue.value === 'minPoints');

function onTargetChange(value: string) {
	customTopN.value = value === 'topN';

	if (value === 'topN') {
		emit('update:conversionMetric', 'topN');
	}
	else if (value === 'minPoints') {
		emit('update:conversionMetric', 'minPoints');
	}
	else if (value.startsWith('topN:')) {
		const n = Number.parseInt(value.split(':')[1]!);
		emit('update:conversionMetric', 'topN');
		emit('update:conversionThreshold', n);
	}
}
</script>

<template>
	<div class="flex items-center gap-2">
		<span class="text-sm text-muted whitespace-nowrap">Conversion to</span>

		<USelect
			:model-value="currentValue"
			:items="conversionItems"
			class="w-44"
			aria-label="Conversion target"
			@update:model-value="onTargetChange"
		/>

		<UInputNumber
			v-if="showThresholdInput"
			:model-value="conversionThreshold"
			:min="conversionMetric === 'topN' ? 1 : 0"
			:max="999"
			class="w-28"
			:aria-label="conversionMetric === 'topN' ? 'Conversion top N placement' : 'Conversion minimum points'"
			@update:model-value="emit('update:conversionThreshold', Number($event))"
		/>
	</div>
</template>
