<script setup lang="ts">
import { METAGAME_CHART_MAX_ARCHETYPES } from '~~/shared/utils/metagameChart';
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * An Archetype's Pinned Chart Series: which of the Theme's chart series every
 * chart colouring Archetypes gives it first, or none. Names a series, never a
 * colour, so the Theme still decides the look.
 */
const props = defineProps<{
	eventId: number;
	archetypeId: number;
}>();

const archetypeStore = useArchetypeStore();

// The other Archetypes' pins, read for the taken warning (#610).
useConsumedEventData(['archetypes']);

onMounted(async () => {
	if (!archetypeStore.isLoaded)
		await archetypeStore.loadByEventId(props.eventId);
});

const archetype = computed(() => archetypeStore.archetypes.find(item => item.id === props.archetypeId));
const pinned = computed(() => archetype.value?.chartSeries ?? null);

function pinnedBy(series: number) {
	return archetypeStore.archetypes.filter(item => item.id !== props.archetypeId && item.chartSeries === series);
}

const items = computed(() => [
	{ label: 'None', value: null },
	...Array.from({ length: METAGAME_CHART_MAX_ARCHETYPES }, (_, index) => {
		const series = index + 1;
		const others = pinnedBy(series).map(item => item.name);
		return {
			label: others.length > 0
				? `Series ${series} (pinned by ${others.join(', ')})`
				: `Series ${series}`,
			value: series,
		};
	}),
]);

const takenBy = computed(() => pinned.value == null
	? []
	: pinnedBy(pinned.value).map(item => item.name));

async function pin(chartSeries: number | null) {
	if (chartSeries === pinned.value)
		return;
	await archetypeStore.updateArchetype(props.eventId, props.archetypeId, { chartSeries });
}
</script>

<template>
	<div v-if="archetype" class="flex flex-col gap-2">
		<div class="flex items-center gap-2">
			<span class="text-sm text-muted whitespace-nowrap">Chart series</span>
			<USelect
				:model-value="pinned"
				:items="items"
				class="w-64"
				aria-label="Chart series"
				@update:model-value="pin($event ?? null)"
			/>
		</div>
		<UAlert
			v-if="takenBy.length > 0"
			data-testid="chart-series-taken"
			color="warning"
			variant="subtle"
			icon="i-lucide-triangle-alert"
			:title="`Series ${pinned} is also pinned by ${takenBy.join(', ')}`"
			description="Where both show on one chart, the Archetype created first keeps it and the other takes a free series."
		/>
	</div>
</template>
