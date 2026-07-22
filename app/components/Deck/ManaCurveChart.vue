<script setup lang="ts">
import type { ManaCurve } from '~~/shared/types/deckList';
import { CURVE_MAX_BUCKET } from '~~/shared/utils/deckStats';

const props = defineProps<{
	curve: ManaCurve;
	height?: number;
}>();

/**
 * Show buckets 0 through the highest non-empty CMC (capped at CURVE_MAX_BUCKET - 1),
 * appending the overflow bucket (CURVE_MAX_BUCKET+) only if it has cards.
 */
const visibleBuckets = computed(() => {
	let maxBucket = 0;
	for (let i = CURVE_MAX_BUCKET - 1; i >= 0; i--) {
		if ((props.curve[i] ?? 0) > 0) {
			maxBucket = i;
			break;
		}
	}
	const buckets = Array.from({ length: maxBucket + 1 }, (_, i) => i);
	if ((props.curve[CURVE_MAX_BUCKET] ?? 0) > 0)
		buckets.push(CURVE_MAX_BUCKET);
	return buckets;
});

const chartHeight = computed(() => props.height ?? 140);

const chartData = computed(() =>
	visibleBuckets.value.map(cmc => ({
		label: cmc === CURVE_MAX_BUCKET ? `${CURVE_MAX_BUCKET}+` : String(cmc),
		count: props.curve[cmc] ?? 0,
	})),
);

const maxCount = computed(() => Math.max(...chartData.value.map(d => d.count), 0));

const countAxis = computed(() => {
	const max = maxCount.value;
	if (max === 0)
		return { interval: 1, max: 1 };

	const idealStep = max <= 4 ? 1 : max <= 10 ? 2 : max <= 20 ? 5 : 10;
	let interval = idealStep;
	while (interval > 1 && Math.ceil(max / interval) < 4)
		interval = Math.max(1, Math.floor(interval / 2));

	return {
		interval,
		max: Math.max(interval, Math.ceil(max / interval) * interval),
	};
});

const chartOption = computed<ECOption>(() => ({
	animation: false,
	stateAnimation: {
		duration: 0,
	},
	grid: {
		top: 8,
		right: 8,
		bottom: 20,
		left: 28,
	},
	tooltip: {
		show: false,
		triggerOn: 'none',
	},
	xAxis: {
		type: 'category',
		data: chartData.value.map(entry => entry.label),
	},
	yAxis: {
		type: 'value',
		min: 0,
		max: countAxis.value.max,
		interval: countAxis.value.interval,
		splitLine: {
			show: true,
		},
	},
	series: [
		{
			type: 'bar',
			silent: true,
			data: chartData.value.map(entry => entry.count),
			barMaxWidth: 32,
			emphasis: {
				disabled: true,
			},
			select: {
				disabled: true,
			},
			itemStyle: {
				borderRadius: [4, 4, 0, 0],
			},
		},
	],
}));
</script>

<template>
	<VChart
		:option="chartOption"
		autoresize
		class="w-full"
		:style="{ height: `${chartHeight}px` }"
	/>
</template>
