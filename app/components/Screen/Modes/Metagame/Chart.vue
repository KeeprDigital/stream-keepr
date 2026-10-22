<script setup lang="ts">
import type { MetagameChartBar } from '~~/shared/utils/metagameChart';
import { useElementSize } from '@vueuse/core';

/**
 * The Metagame Screen's chart display: meta share by Archetype as horizontal
 * bars, each labelled with its name, mana colours and share. HTML rather than
 * a canvas chart, so its text takes the Screen's fonts and text colours and
 * stays crisp at any output size. Its text colour is the Metagame Display's
 * `--metagame-primary-text`, set by the Display that hosts it.
 */
const props = defineProps<{
	bars: MetagameChartBar[];
	animate: boolean;
}>();

const plotRef = useTemplateRef<HTMLElement>('plotRef');
const { height: plotHeight } = useElementSize(plotRef);

// Rows share the plot's height, like the table's; the type scales with them.
const layoutStyle = computed(() => {
	const rowCount = Math.max(props.bars.length, 1);
	const rowHeight = plotHeight.value > 0 ? plotHeight.value / rowCount : 56;
	const fontSize = Math.min(Math.max(14, rowHeight * 0.34), 44);

	return {
		'--metagame-chart-font-size': `${fontSize}px`,
		'--metagame-chart-bar-thickness': `${Math.min(Math.max(8, rowHeight * 0.42), 40)}px`,
	};
});

function fillOf(bar: MetagameChartBar): string {
	return bar.colorSlot == null
		? 'var(--metagame-chart-other)'
		: `var(--metagame-chart-series-${bar.colorSlot})`;
}
</script>

<template>
	<div
		ref="plotRef"
		class="metagame-chart"
		role="list"
		aria-label="Meta share by archetype"
		data-testid="metagame-chart"
		:style="layoutStyle"
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
			<div class="metagame-chart-track">
				<!-- A live update grows or shrinks each bar in place when entries animate. -->
				<div
					class="metagame-chart-fill"
					:class="{ 'is-animated': animate }"
					data-testid="metagame-chart-fill"
					:style="{ '--bar-length': bar.length, 'background': fillOf(bar) }"
				/>
				<span class="metagame-chart-share" data-testid="metagame-chart-share">{{ bar.metaShare }}%</span>
			</div>
		</div>
	</div>
</template>

<style scoped>
/*
 * Categorical slots stepped for a dark surface, the background a broadcast
 * overlay usually sits on; validated as a set for adjacent-pair CVD
 * separation and >= 3:1 against #1a1a19. Every bar is named, so identity
 * never rests on its colour alone. Other is the neutral, never a slot.
 */
.metagame-chart {
	--metagame-chart-series-1: #3987e5;
	--metagame-chart-series-2: #d95926;
	--metagame-chart-series-3: #199e70;
	--metagame-chart-series-4: #c98500;
	--metagame-chart-series-5: #d55181;
	--metagame-chart-series-6: #008300;
	--metagame-chart-series-7: #9085e9;
	--metagame-chart-series-8: #e66767;
	--metagame-chart-other: #898781;
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

/* Text keeps the Screen's text colours, with a soft shadow to read over any video. */
.metagame-chart-name,
.metagame-chart-share {
	color: var(--metagame-primary-text);
	text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
	line-height: 1.1;
	white-space: nowrap;
}

.metagame-chart-name {
	font-weight: 600;
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
	border-left: 1px solid rgba(255, 255, 255, 0.24);
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
	font-weight: 700;
}
</style>
