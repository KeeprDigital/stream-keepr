<script setup lang="ts">
import type { PlayerSide } from '~~/shared/types/enums';

const props = withDefaults(defineProps<{
	mode?: 'counter' | 'selection';
	label?: string;
	leftDisabled?: boolean;
	/** Which half of the turn: 1 = first half, 2 = second half, undefined = hidden */
	half?: 1 | 2;
	/** Scales up buttons and text for touch-screen use */
	touch?: boolean;
	/** Layout direction */
	orientation?: 'horizontal' | 'vertical';
}>(), {
	mode: 'counter',
	leftDisabled: false,
	touch: false,
	orientation: 'horizontal',
});

const emit = defineEmits<{
	change: [delta: number];
	select: [player: PlayerSide];
}>();

const isVertical = computed(() => props.orientation === 'vertical');

const btnSize = computed(() => props.touch ? 'xl' as const : undefined);
const btnClass = computed(() => props.touch ? 'rounded-3xl p-5' : '');
const wrapperClass = computed(() => {
	if (isVertical.value) {
		return props.touch ? 'flex-col-reverse gap-4 py-6 px-5 min-w-[14rem]' : 'flex-col-reverse gap-1 py-2 px-2';
	}
	return props.touch ? 'gap-6 py-5 px-6' : 'gap-3 py-2 px-3';
});
const labelClass = computed(() => {
	if (isVertical.value) {
		return props.touch ? 'text-2xl font-bold' : 'text-md font-medium';
	}
	return props.touch ? 'text-2xl font-bold min-w-[140px]' : 'text-md font-medium min-w-[60px]';
});

const leftIcon = computed(() =>
	props.mode === 'selection' ? 'i-lucide-arrow-left' : 'i-lucide-minus',
);

const rightIcon = computed(() =>
	props.mode === 'selection' ? 'i-lucide-arrow-right' : 'i-lucide-plus',
);

function handleLeft() {
	if (props.mode === 'selection') {
		emit('select', 'player1');
	}
	else {
		emit('change', -1);
	}
}

function handleRight() {
	if (props.mode === 'selection') {
		emit('select', 'player2');
	}
	else {
		emit('change', 1);
	}
}
</script>

<template>
	<div class="flex items-center justify-center" :class="wrapperClass">
		<UButton
			:icon="leftIcon"
			color="neutral"
			variant="ghost"
			:size="btnSize"
			:class="btnClass"
			:disabled="leftDisabled"
			:aria-label="mode === 'selection' ? 'Player 1 goes first' : 'Previous step'"
			@click="handleLeft"
		/>
		<div class="flex items-center justify-center" :class="isVertical ? 'flex-col gap-2' : 'gap-3 w-full'">
			<span class="text-center" :class="labelClass">
				{{ label ?? (mode === 'selection' ? 'Who plays first?' : 'Step') }}
			</span>
			<span v-if="half" class="inline-flex gap-1 items-center" :class="touch ? 'text-lg' : 'text-xs'">
				<span :class="half === 1 ? 'text-(--ui-primary)' : 'text-(--ui-text-muted)'">&#9679;</span>
				<span :class="half === 2 ? 'text-(--ui-primary)' : 'text-(--ui-text-muted)'">&#9679;</span>
			</span>
		</div>
		<UButton
			:icon="rightIcon"
			color="neutral"
			variant="ghost"
			:size="btnSize"
			:class="btnClass"
			:aria-label="mode === 'selection' ? 'Player 2 goes first' : 'Next step'"
			@click="handleRight"
		/>
	</div>
</template>
