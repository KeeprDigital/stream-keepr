<script setup lang="ts">
import type { CounterState } from '~~/shared/types/featureMatchState';
import type { CounterTypeConfig } from '~~/shared/types/game';
import { getCounterTypeConfigs } from '~~/shared/config/games';

const props = withDefaults(defineProps<{
	matchId: number;
	player: PlayerSide;
	counters: CounterState[];
	/** Scales up buttons and text for touch-screen use */
	touch?: boolean;
	/** Number of columns to use for touch-screen layouts */
	touchColumns?: 1 | 2 | 3;
	/** Keeps counters visible but removes interaction affordances */
	readonly?: boolean;
	/** Counter types this player can add; omitted falls back to game defaults */
	availableCounterTypes?: CounterTypeConfig[];
}>(), {
	touch: false,
	touchColumns: 1,
	readonly: false,
});

const playerControls = usePlayerControls(() => props.matchId, () => props.player);
const eventStore = useEventStore();

const counterTypeConfigs = computed(() => {
	if (props.availableCounterTypes) {
		return props.availableCounterTypes;
	}
	const game = eventStore.event?.game;
	return game ? getCounterTypeConfigs(game) : [];
});

const showAddMenu = ref(false);

// Build a lookup map from key → config for quick access
const configByKey = computed(() => {
	const map = new Map<string, (typeof counterTypeConfigs.value)[number]>();
	for (const config of counterTypeConfigs.value) {
		map.set(config.key, config);
	}
	return map;
});

// Available counter types to add (excluding already added ones)
const addableCounterTypes = computed(() => {
	const existing = new Set(props.counters.map(c => c.type));
	return counterTypeConfigs.value.filter(config => !existing.has(config.key));
});

function handleCounterChange(index: number, delta: number) {
	const updated = [...props.counters];
	const counter = updated[index];
	if (!counter)
		return;

	const newValue = Math.max(0, counter.value + delta);
	updated[index] = { ...counter, value: newValue };
	playerControls.updateCounters(updated);
}

function handleReset(index: number) {
	const updated = [...props.counters];
	const counter = updated[index];
	if (!counter)
		return;

	updated[index] = { ...counter, value: 0 };
	playerControls.updateCounters(updated);
}

function handleRemove(index: number) {
	const updated = [...props.counters];
	updated.splice(index, 1);
	playerControls.updateCounters(updated);
}

function addCounter(key: string) {
	const updated = [...props.counters, { type: key, value: 0 }];
	playerControls.updateCounters(updated);
	showAddMenu.value = false;
}

const touchGridClass = computed(() => {
	if (!props.touch) {
		return 'grid-cols-1 md:grid-cols-2 gap-2';
	}

	if (props.touchColumns === 3) {
		return 'grid-cols-3 gap-3';
	}

	if (props.touchColumns === 2) {
		return 'grid-cols-2 gap-3';
	}

	return 'grid-cols-1 gap-3';
});

const addButtonClass = computed(() => {
	if (props.touch) {
		return props.touchColumns > 1 ? 'col-span-full justify-self-center' : 'justify-self-center';
	}

	return 'md:col-span-2 md:justify-self-center';
});
</script>

<template>
	<div class="grid max-w-full" :class="touchGridClass">
		<FeatureMatchStateCounterItem
			v-for="(counter, index) in counters"
			:key="counter.type"
			:counter="counter"
			:config="configByKey.get(counter.type)"
			:touch="touch"
			:readonly="readonly"
			:class="touch ? '' : { 'md:col-span-2 md:justify-self-center': index === counters.length - 1 && counters.length % 2 === 1 }"
			@change="(delta) => handleCounterChange(index, delta)"
			@reset="handleReset(index)"
			@remove="handleRemove(index)"
		/>

		<UPopover
			v-if="!readonly && addableCounterTypes.length > 0"
			v-model:open="showAddMenu"
			:class="addButtonClass"
		>
			<UButton
				icon="i-lucide-plus"
				color="neutral"
				variant="soft"
				:size="touch ? 'lg' : 'xs'"
				:class="touch ? 'rounded-full p-4' : ''"
				aria-label="Add counter"
			/>

			<template #content>
				<div class="flex flex-col w-min" :class="touch ? 'p-3 gap-2' : 'p-2 gap-1'">
					<UButton
						v-for="config in addableCounterTypes"
						:key="config.key"
						:icon="config.icon"
						block
						color="neutral"
						variant="ghost"
						:size="touch ? 'lg' : 'sm'"
						@click="addCounter(config.key)"
					>
						{{ config.label }}
					</UButton>
				</div>
			</template>
		</UPopover>
	</div>
</template>
