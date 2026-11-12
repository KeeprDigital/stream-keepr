<script setup lang="ts">
/**
 * The one number input of a settings surface. It shows a `displayScale` value in
 * displayed units (seconds) and emits in stored ones (milliseconds); an emptied
 * input emits `null`, which its field decides the meaning of.
 *
 * It is as wide as a field row's end unless `fill` gives it its container's
 * width. Every other attribute (`size`, `disabled`, aria-*, data-*) lands on the
 * input.
 */
const props = withDefaults(defineProps<{
	modelValue: number | null | undefined;
	min?: number;
	max?: number;
	/** In displayed units. */
	step?: number;
	/** Stored units per displayed unit. */
	displayScale?: number;
	fill?: boolean;
}>(), { displayScale: 1 });

const emit = defineEmits<{ 'update:modelValue': [value: number | null] }>();

const displayed = computed(() => typeof props.modelValue === 'number' && props.displayScale !== 1
	? props.modelValue / props.displayScale
	: props.modelValue);

/** Displayed units back to stored ones, without the float noise a scale adds (4.1 s is 4100 ms). */
function toStored(value: number): number {
	return props.displayScale === 1
		? value
		: Number((value * props.displayScale).toPrecision(12));
}

function update(value: number | null | undefined) {
	emit('update:modelValue', typeof value === 'number' && !Number.isNaN(value)
		? toStored(value)
		: null);
}
</script>

<template>
	<UInputNumber
		:model-value="displayed"
		:min="min"
		:max="max"
		:step="step"
		:class="fill ? 'w-full' : 'w-32'"
		@update:model-value="update"
	/>
</template>
