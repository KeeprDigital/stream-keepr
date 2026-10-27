<script setup lang="ts">
import type { MetagameChartBar } from '~~/shared/utils/metagameChart';
import { useElementSize } from '@vueuse/core';
import { modeTokenVar } from '~/modules/screen-mode';

/**
 * The Metagame Screen's chart display: meta share by Archetype as horizontal
 * bars, each labelled with its name, mana colours and share. HTML rather than
 * a canvas chart, so its text takes the Metagame Mode Tokens and stays crisp
 * at any output size. Its labels' type and colour are the row type and
 * primary text the Display hosting it sets.
 */
const props = defineProps<{
	bars: MetagameChartBar[];
	animate: boolean;
}>();

/** Each categorical colour slot's fill, slot 1 first. */
const SERIES_FILLS = [
	modeTokenVar('metagame', 'chart-series-1'),
	modeTokenVar('metagame', 'chart-series-2'),
	modeTokenVar('metagame', 'chart-series-3'),
	modeTokenVar('metagame', 'chart-series-4'),
	modeTokenVar('metagame', 'chart-series-5'),
	modeTokenVar('metagame', 'chart-series-6'),
	modeTokenVar('metagame', 'chart-series-7'),
	modeTokenVar('metagame', 'chart-series-8'),
];

const chartStyle = {
	backgroundColor: modeTokenVar('metagame', 'surface'),
};
const trackStyle = {
	borderLeftColor: modeTokenVar('metagame', 'chart-baseline'),
};

const plotRef = useTemplateRef<HTMLElement>('plotRef');
const { height: plotHeight } = useElementSize(plotRef);

// Rows share the plot's height, like the table's; the type scales with them.
const layoutStyle = computed(() => {
	const rowCount = Math.max(props.bars.length, 1);
	const rowHeight = plotHeight.value > 0
		? plotHeight.value / rowCount
		: 56;
	const fontSize = Math.min(Math.max(14, rowHeight * 0.34), 44);

	return {
		'--metagame-chart-font-size': `${fontSize}px`,
		'--metagame-chart-bar-thickness': `${Math.min(Math.max(8, rowHeight * 0.42), 40)}px`,
	};
});

function fillOf(bar: MetagameChartBar): string {
	return bar.colorSlot == null
		? modeTokenVar('metagame', 'chart-other')
		: SERIES_FILLS[bar.colorSlot - 1]!;
}
</script>

<template>
	<div
		ref="plotRef"
		class="metagame-chart"
		role="list"
		aria-label="Meta share by archetype"
		data-testid="metagame-chart"
		:style="[chartStyle, layoutStyle]"
	>
		<div
			v-for="bar in bars"
			:key="bar.id"
			class="metagame-chart-row"
			role="listitem"
			data-testid="metagame-chart-bar"
		>
			<div class="metagame-chart-label">
				<span class="metagame-chart-name" data-testid="metagame-chart-name">{{ bar.name }}</span>
				<MtgManaColorDisplay
					v-if="bar.colors"
					:colors="bar.colors"
					size="sm"
					class="metagame-chart-mana"
				/>
			</div>
			<div class="metagame-chart-track" :style="trackStyle">
				<!-- A live update grows or shrinks each bar in place when entries animate. -->
				<div
					class="metagame-chart-fill"
					:class="{ 'is-animated': animate }"
					data-testid="metagame-chart-fill"
					:data-color-slot="bar.colorSlot ?? 'other'"
					:style="{ '--bar-length': bar.length, 'backgroundColor': fillOf(bar) }"
				/>
				<span class="metagame-chart-share" data-testid="metagame-chart-share">{{ bar.metaShare }}%</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
.metagame-chart {
	--metagame-chart-value-width: 5.5em;

	flex: 1 1 0;
	min-height: 0;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	padding: 0.5rem 1rem;
	font-size: var(--metagame-chart-font-size, 1rem);
}

.metagame-chart-row {
	flex: 1 1 0;
	min-height: 0;
	display: grid;
	grid-template-columns: minmax(0, 2fr) minmax(0, 5fr);
	align-items: center;
	gap: 0.75em;
}

.metagame-chart-label {
	display: flex;
	align-items: center;
	justify-content: flex-end;
	gap: 0.5em;
	min-width: 0;
}

.metagame-chart-name,
.metagame-chart-share {
	white-space: nowrap;
}

.metagame-chart-name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}

.metagame-chart-mana {
	flex-shrink: 0;
}

/* The baseline every bar grows from: a recessive hairline. */
.metagame-chart-track {
	display: flex;
	align-items: center;
	height: 100%;
	min-width: 0;
	border-left-style: solid;
	border-left-width: 1px;
}

/* The leader spans the plot less the room its share label needs at its tip. */
.metagame-chart-fill {
	flex-shrink: 0;
	width: calc((100% - var(--metagame-chart-value-width)) * var(--bar-length));
	min-width: 2px;
	height: var(--metagame-chart-bar-thickness, 24px);
	border-radius: 0 4px 4px 0;
}

.metagame-chart-fill.is-animated {
	transition: width 0.5s ease;
}

.metagame-chart-share {
	padding-left: 0.5em;
}
</style>
