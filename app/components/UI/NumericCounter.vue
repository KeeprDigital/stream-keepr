<script setup lang="ts">
type CounterOrientation = 'horizontal' | 'vertical';

const props = withDefaults(defineProps<{
	value: number;
	min?: number;
	max?: number;
	/** Scales up all targets and text for touch-screen use */
	touch?: boolean;
	/** Gives the counter extra emphasis for primary screen controls */
	hero?: boolean;
	/** Reduces sizing for inline/secondary counters */
	compact?: boolean;
	/** Layout direction for controls */
	orientation?: CounterOrientation;
	/** Disables all interactive elements */
	disabled?: boolean;
	/** Hides adjustment affordances while keeping the value shell visible */
	readonly?: boolean;
	/** Context announced by assistive technology, for example "Alice life total". */
	accessibleLabel?: string;
}>(), {
	min: undefined,
	max: undefined,
	touch: false,
	hero: false,
	compact: false,
	orientation: 'horizontal',
	disabled: false,
	readonly: false,
	accessibleLabel: 'value',
});

const emit = defineEmits<{
	adjust: [delta: number];
	set: [value: number];
}>();

const editValue = ref(props.value);
const isEditing = ref(false);
const input = useTemplateRef<{ inputRef?: HTMLInputElement | null }>('input');

watch(() => props.value, (newVal) => {
	if (!isEditing.value) {
		editValue.value = newVal;
	}
});

function clampValue(value: number) {
	let clamped = value;
	if (props.min !== undefined)
		clamped = Math.max(props.min, clamped);
	if (props.max !== undefined)
		clamped = Math.min(props.max, clamped);
	return clamped;
}

function setValue(value: number) {
	const clamped = clampValue(value);
	editValue.value = clamped;
	if (clamped !== props.value) {
		emit('set', clamped);
	}
}

function commitValue() {
	isEditing.value = false;
	setValue(editValue.value);
}

function handleBlur() {
	if (isEditing.value) {
		commitValue();
	}
}

function revertValue() {
	isEditing.value = false;
	editValue.value = props.value;
}

function blurInput() {
	input.value?.inputRef?.blur();
}

function handleFocus() {
	isEditing.value = true;
	input.value?.inputRef?.select();
}

function handleKeydown(event: KeyboardEvent) {
	if (event.key === 'Enter') {
		commitValue();
		blurInput();
	}
	else if (event.key === 'Escape') {
		revertValue();
		blurInput();
	}
}

const currentValue = computed(() => isEditing.value ? editValue.value : props.value);
const minReached = computed(() => props.min !== undefined && currentValue.value <= props.min);
const maxReached = computed(() => props.max !== undefined && currentValue.value >= props.max);
const isVertical = computed(() => props.orientation === 'vertical');
const isHeroVertical = computed(() => props.hero && props.touch && isVertical.value && !props.compact);

function handleAdjust(delta: number) {
	const nextValue = clampValue(currentValue.value + delta);
	const appliedDelta = nextValue - currentValue.value;
	if (appliedDelta === 0)
		return;
	emit('adjust', appliedDelta);
}

const touchWidthClass = computed(() => {
	if (!props.touch)
		return '';

	if (props.compact)
		return 'w-[6rem]';

	return isHeroVertical.value ? 'w-[11rem]' : 'w-[7.25rem]';
});

const inputClass = computed(() => {
	if (props.compact) {
		return props.touch
			? `text-center rounded-xl px-3 py-2 text-3xl ${touchWidthClass.value}`
			: 'text-center rounded-lg p-0.5 text-base w-[4ch]';
	}

	return props.touch
		? isHeroVertical.value
			? `text-center rounded-2xl px-3 py-1 text-[6.75rem] leading-none ${touchWidthClass.value}`
			: `text-center rounded-2xl px-2 py-1.5 text-6xl leading-none ${touchWidthClass.value}`
		: 'text-center rounded-lg p-2 text-6xl w-[4ch]';
});

const inputSize = computed(() => {
	if (props.compact)
		return props.touch ? 'lg' as const : 'sm' as const;
	return 'xl' as const;
});

const btnSize = computed(() => {
	if (props.compact)
		return props.touch ? 'xl' as const : 'sm' as const;
	return props.touch ? 'xl' as const : 'lg' as const;
});

const btnClass = computed(() => {
	if (props.touch && isVertical.value) {
		return props.compact
			? `inline-flex items-center justify-center rounded-xl h-14 ${touchWidthClass.value}`
			: isHeroVertical.value
				? `inline-flex items-center justify-center rounded-2xl h-[4.75rem] ${touchWidthClass.value}`
				: `inline-flex items-center justify-center rounded-2xl h-16 ${touchWidthClass.value}`;
	}

	if (props.compact)
		return props.touch ? 'rounded-full p-5' : 'rounded-full';

	return props.touch ? 'rounded-full p-6' : 'rounded-full p-4';
});

const containerClass = computed(() => [
	'flex items-center justify-center',
	isVertical.value ? 'flex-col' : 'flex-row',
	props.touch && !props.compact ? 'gap-4' : 'gap-3',
]);
</script>

<template>
	<div :class="containerClass">
		<UButton
			v-if="!readonly"
			icon="i-lucide-minus"
			color="neutral"
			variant="soft"
			:size="btnSize"
			:class="[btnClass, isVertical && 'order-3']"
			:disabled="disabled || minReached"
			:aria-label="`Decrease ${accessibleLabel}`"
			@click="handleAdjust(-1)"
		/>

		<UInputNumber
			ref="input"
			v-model="editValue"
			variant="soft"
			:size="inputSize"
			:min="min"
			:max="max"
			:ui="{ base: inputClass }"
			:increment="false"
			:decrement="false"
			:disabled="disabled || readonly"
			:class="isVertical && 'order-2'"
			:aria-readonly="readonly"
			:aria-label="accessibleLabel"
			@blur="handleBlur"
			@keydown="handleKeydown"
			@focus="handleFocus"
		/>

		<UButton
			v-if="!readonly"
			icon="i-lucide-plus"
			color="neutral"
			variant="soft"
			:size="btnSize"
			:class="[btnClass, isVertical && 'order-1']"
			:disabled="disabled || maxReached"
			:aria-label="`Increase ${accessibleLabel}`"
			@click="handleAdjust(1)"
		/>
	</div>
</template>
