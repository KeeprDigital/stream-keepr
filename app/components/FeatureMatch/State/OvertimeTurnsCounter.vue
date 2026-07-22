<script setup lang="ts">
import type { OvertimeState } from '~~/shared/types/featureMatchState';

const props = withDefaults(defineProps<{
	overtime: OvertimeState;
	label?: string;
	/** Scales up buttons and text for touch-screen use */
	touch?: boolean;
	/** Layout direction */
	orientation?: 'horizontal' | 'vertical';
}>(), {
	label: 'Extra Turns',
	touch: false,
	orientation: 'horizontal',
});

const emit = defineEmits<{
	nextTurn: [];
	prevTurn: [];
}>();

const turnsUsed = computed(() => props.overtime.totalTurns - props.overtime.turnsRemaining);
const isComplete = computed(() => props.overtime.turnsRemaining <= 0);
const canGoBack = computed(() => turnsUsed.value > 0);

const isVertical = computed(() => props.orientation === 'vertical');

const btnSize = computed(() => props.touch ? 'xl' as const : undefined);
const btnClass = computed(() => props.touch ? 'rounded-3xl p-5' : '');
const wrapperClass = computed(() => {
	if (isVertical.value) {
		return props.touch ? 'flex-col-reverse gap-4 py-6 px-5 min-w-[14rem]' : 'flex-col-reverse gap-1 py-2 px-2';
	}
	return props.touch ? 'gap-6 py-5 px-6' : 'gap-3 py-2 px-3';
});
const labelClass = computed(() => props.touch ? 'text-lg' : 'text-xs');
const countClass = computed(() => props.touch ? 'text-4xl' : 'text-md');
</script>

<template>
	<div class="flex items-center justify-center bg-elevated rounded-lg" :class="wrapperClass">
		<UButton
			icon="i-lucide-minus"
			color="neutral"
			variant="ghost"
			:size="btnSize"
			:class="btnClass"
			:disabled="!canGoBack"
			aria-label="Previous overtime turn"
			@click="emit('prevTurn')"
		/>
		<div class="flex flex-col items-center gap-1.5">
			<span
				class="font-semibold uppercase tracking-wide"
				:class="[labelClass, isComplete ? 'text-error' : 'text-warning']"
			>
				{{ label }}
			</span>
			<span
				class="font-bold tabular-nums"
				:class="[countClass, isComplete ? 'text-error' : '']"
			>
				{{ turnsUsed }} / {{ overtime.totalTurns }}
			</span>
		</div>
		<UButton
			icon="i-lucide-plus"
			color="neutral"
			variant="ghost"
			:size="btnSize"
			:class="btnClass"
			:disabled="isComplete"
			aria-label="Next overtime turn"
			@click="emit('nextTurn')"
		/>
	</div>
</template>
