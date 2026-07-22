<script setup lang="ts">
import type { DefaultLabelFormatterCallbackParams, TooltipComponentFormatterCallbackParams } from 'echarts';
import type { ArchetypeBreakdownEntry } from '~~/shared/types/metagame';
import { formatPercent } from '~~/app/utils/metagame';

interface BarDatum {
	name: string;
	value: number;
	metaShare: number;
	winRate: number | null;
}

const props = defineProps<{
	entries: ArchetypeBreakdownEntry[];
	totalPlayers: number;
	loading?: boolean;
}>();

const emit = defineEmits<{
	(e: 'select', archetype: string): void;
}>();

const LABEL_GUTTER_WIDTH = 176;
const BAR_ROW_HEIGHT = 36;
const BAR_HEIGHT = 20;
const CHART_VERTICAL_PADDING = 32;
const LOADING_ROW_COUNT = 4;

const countFormatter = new Intl.NumberFormat();

function formatCount(value: number) {
	return countFormatter.format(value);
}

function formatPlayerCount(value: number) {
	return `${formatCount(value)} player${value === 1 ? '' : 's'}`;
}

function sortByDefaultOrder(left: ArchetypeBreakdownEntry, right: ArchetypeBreakdownEntry) {
	if (right.metaShare !== left.metaShare)
		return right.metaShare - left.metaShare;

	return left.name.localeCompare(right.name);
}

const sortedEntries = computed(() => [...props.entries].sort(sortByDefaultOrder));

const chartData = computed<BarDatum[]>(() =>
	sortedEntries.value.map(entry => ({
		name: entry.name,
		value: entry.count,
		metaShare: entry.metaShare,
		winRate: entry.winRate,
	})),
);

const chartHeight = computed(() => CHART_VERTICAL_PADDING + sortedEntries.value.length * BAR_ROW_HEIGHT);
const loadingHeight = computed(() => CHART_VERTICAL_PADDING + Math.max(sortedEntries.value.length, LOADING_ROW_COUNT) * BAR_ROW_HEIGHT);

function tooltipFormatter(params: TooltipComponentFormatterCallbackParams) {
	const datum = Array.isArray(params) ? params[0] : params;
	const entry = datum?.data as BarDatum | undefined;
	if (!entry)
		return '';

	const lines = [
		`<strong>${entry.name}</strong>`,
		formatPlayerCount(entry.value),
		`${formatPercent(entry.metaShare)} of field`,
	];

	if (entry.winRate != null)
		lines.push(`${formatPercent(entry.winRate)} win rate`);

	return lines.join('<br/>');
}

function labelFormatter(params: DefaultLabelFormatterCallbackParams) {
	const value = typeof params.value === 'number'
		? params.value
		: Number((params.data as BarDatum | undefined)?.value ?? 0);

	return formatCount(value);
}

function handleChartClick(params: { componentType?: string; name?: string | number }) {
	if (params.componentType !== 'series' || typeof params.name !== 'string')
		return;

	emit('select', params.name);
}

const chartOption = computed<ECOption>(() => {
	const option: ECOption = {
		grid: {
			top: 16,
			right: 64,
			bottom: 16,
			left: LABEL_GUTTER_WIDTH,
		},
		tooltip: {
			trigger: 'item',
			formatter: tooltipFormatter,
		},
		xAxis: {
			type: 'value',
			min: 0,
			axisLabel: { show: false },
			axisTick: { show: false },
			axisLine: { show: false },
			splitLine: { show: false },
		},
		yAxis: {
			type: 'category',
			inverse: true,
			data: sortedEntries.value.map(entry => entry.name),
			axisTick: { show: false },
			axisLine: { show: false },
			axisLabel: {
				width: LABEL_GUTTER_WIDTH - 12,
				overflow: 'truncate',
			},
			splitLine: { show: false },
		},
		series: [
			{
				type: 'bar',
				data: chartData.value,
				barWidth: BAR_HEIGHT,
				label: {
					show: true,
					position: 'right',
					distance: 8,
					fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, Courier New, monospace',
					formatter: labelFormatter,
				},
				itemStyle: {
					borderRadius: [0, 4, 4, 0],
				},
				emphasis: {
					itemStyle: {
						opacity: 0.9,
					},
				},
			},
		],
	};

	return option;
});
</script>

<template>
	<div v-if="entries.length === 0 && !loading" class="text-center text-muted py-8">
		No archetype data available
	</div>
	<div v-else class="relative">
		<VChart
			v-if="sortedEntries.length > 0"
			:option="chartOption"
			autoresize
			class="w-full cursor-pointer"
			:class="loading ? 'opacity-60' : ''"
			:style="{ height: `${chartHeight}px` }"
			@click="handleChartClick"
		/>
		<div
			v-else
			class="w-full"
			:style="{ height: `${loadingHeight}px` }"
		/>

		<div
			v-if="loading"
			data-testid="archetype-bar-chart-loading-overlay"
			class="absolute inset-0 flex items-center justify-center bg-default/70"
		>
			<UILoadingSpinner />
		</div>
	</div>
</template>
