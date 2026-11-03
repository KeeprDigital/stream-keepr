<script setup lang="ts">
import type { ConversionTarget } from '~~/shared/conversionTarget';
import { CONVERSION_THRESHOLD_BOUNDS } from '~~/shared/conversionTarget';

/**
 * The Event's Conversion Target (ADR-0061), edited whole: each change is
 * emitted as the complete target, its threshold within its metric's bounds.
 */
const props = defineProps<ConversionTarget>();

const emit = defineEmits<{
	(e: 'update', target: ConversionTarget): void;
}>();

const TOP_N_PRESETS = [8, 16, 32];

const conversionItems = computed(() => [
	...TOP_N_PRESETS.map(n => ({ label: `Top ${n}`, value: `topN:${n}` })),
	{ label: 'Top N…', value: 'topN' },
	{ label: 'Minimum Points…', value: 'minPoints' },
]);

const bounds = computed(() => CONVERSION_THRESHOLD_BOUNDS[props.conversionMetric]);

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

/** The target `metric` names, keeping the threshold where that metric's bounds allow it. */
function withMetric(conversionMetric: ConversionTarget['conversionMetric'], threshold = props.conversionThreshold): ConversionTarget {
	const { min, max } = CONVERSION_THRESHOLD_BOUNDS[conversionMetric];
	return {
		conversionMetric,
		conversionThreshold: Math.min(max, Math.max(min, threshold)),
	};
}

function onTargetChange(value: string) {
	customTopN.value = value === 'topN';

	if (value === 'topN' || value === 'minPoints')
		emit('update', withMetric(value));
	else if (value.startsWith('topN:'))
		emit('update', withMetric('topN', Number.parseInt(value.split(':')[1]!)));
}

function onThresholdChange(value: number | null | undefined) {
	if (value == null || Number.isNaN(Number(value)))
		return;
	emit('update', withMetric(props.conversionMetric, Number(value)));
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
			:min="bounds.min"
			:max="bounds.max"
			class="w-28"
			:aria-label="conversionMetric === 'topN' ? 'Conversion top N placement' : 'Conversion minimum points'"
			@update:model-value="onThresholdChange"
		/>
	</div>
</template>
