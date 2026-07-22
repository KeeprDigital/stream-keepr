<script setup lang="ts">
import type { CounterTypeConfig } from '~~/shared/config/games';
import type { CounterState } from '~~/shared/types/featureMatchState';

const props = withDefaults(defineProps<{
	counter: CounterState;
	config?: CounterTypeConfig;
	/** Scales up buttons and text for touch-screen use */
	touch?: boolean;
	/** Keeps counter values visible but removes interaction affordances */
	readonly?: boolean;
}>(), {
	touch: false,
	readonly: false,
});

const emit = defineEmits<{
	change: [delta: number];
	remove: [];
	reset: [];
}>();

const showActions = ref(false);

const label = computed(() => {
	if (!props.config)
		return props.counter.type;
	return props.config.shortLabel ?? props.config.label;
});

const icon = computed(() => {
	return props.config?.icon ?? 'i-lucide-hash';
});

function handleReset() {
	showActions.value = false;
	emit('reset');
}

function handleRemove() {
	showActions.value = false;
	emit('remove');
}

const labelBtnSize = computed(() => props.touch ? 'md' as const : 'sm' as const);
const popoverBtnSize = computed(() => props.touch ? 'md' as const : 'xs' as const);
</script>

<template>
	<div class="flex flex-col items-center" :class="touch ? 'gap-2.5' : 'gap-1.5'">
		<UButton
			v-if="readonly"
			:label="label"
			:icon="icon"
			color="neutral"
			variant="ghost"
			:size="labelBtnSize"
			disabled
			:class="touch ? 'px-3 py-1.5' : ''"
		/>
		<UPopover v-else v-model:open="showActions">
			<UButton
				:label="label"
				:icon="icon"
				color="neutral"
				variant="ghost"
				:aria-label="`${label} counter actions`"
				:size="labelBtnSize"
				:class="touch ? 'px-3 py-1.5' : ''"
			/>

			<template #content>
				<div class="flex flex-col" :class="touch ? 'p-2 gap-1.5' : 'p-1 gap-0.5'">
					<UButton
						icon="i-lucide-rotate-ccw"
						color="neutral"
						variant="ghost"
						:size="popoverBtnSize"
						block
						:label="`Reset ${label}`"
						@click="handleReset"
					/>
					<UButton
						icon="i-lucide-trash-2"
						color="error"
						variant="ghost"
						:size="popoverBtnSize"
						block
						:label="`Remove ${label}`"
						@click="handleRemove"
					/>
				</div>
			</template>
		</UPopover>

		<UINumericCounter
			:value="counter.value"
			:accessible-label="label"
			:min="0"
			:touch="touch"
			:compact="!touch"
			:orientation="touch ? 'vertical' : 'horizontal'"
			:readonly="readonly"
			@adjust="(delta: number) => emit('change', delta)"
			@set="(val: number) => emit('change', val - counter.value)"
		/>
	</div>
</template>
