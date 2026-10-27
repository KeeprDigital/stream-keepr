<script setup lang="ts">
import { formatEditableColor, parseEditableColor } from '~/modules/theme-editor/color';

// A colour token, which may be translucent: a swatch for the colour, a slider for
// its alpha, and the CSS value itself for anything else. Each commits once, when
// the edit is finished, so dragging writes nothing until it ends.

const props = defineProps<{
	modelValue: string;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: string];
}>();

const parsed = computed(() => parseEditableColor(props.modelValue));
const typed = ref(props.modelValue);
watch(() => props.modelValue, (value) => {
	typed.value = value;
});

function commitSwatch(event: Event) {
	const hex = (event.target as HTMLInputElement).value;
	emit('commit', formatEditableColor({ hex, alpha: parsed.value?.alpha ?? 1 }));
}

function commitAlpha(event: Event) {
	const alpha = Number((event.target as HTMLInputElement).value) / 100;
	emit('commit', formatEditableColor({ hex: parsed.value?.hex ?? '#000000', alpha }));
}

function commitTyped() {
	const value = typed.value.trim();
	if (value && value !== props.modelValue)
		emit('commit', value);
	else
		typed.value = props.modelValue;
}
</script>

<template>
	<div class="flex flex-wrap items-center gap-3">
		<span
			class="size-8 shrink-0 rounded-md border border-default checkerboard"
			aria-hidden="true"
		>
			<span class="block size-full rounded-md" :style="{ background: modelValue }" />
		</span>
		<input
			type="color"
			class="h-8 w-10 cursor-pointer rounded border border-default bg-transparent"
			:value="parsed?.hex ?? '#000000'"
			:aria-label="`${label} colour`"
			data-token-part="colour"
			@change="commitSwatch"
		>
		<label class="flex items-center gap-2 text-xs text-muted">
			Opacity
			<input
				type="range"
				min="0"
				max="100"
				step="1"
				class="w-28"
				:value="Math.round((parsed?.alpha ?? 1) * 100)"
				:aria-label="`${label} opacity`"
				data-token-part="opacity"
				@change="commitAlpha"
			>
			<span class="w-9 tabular-nums">{{ Math.round((parsed?.alpha ?? 1) * 100) }}%</span>
		</label>
		<UInput
			v-model="typed"
			size="sm"
			class="w-48 font-mono"
			:aria-label="`${label} CSS colour`"
			data-token-part="css"
			@blur="commitTyped"
			@keydown.enter.prevent="commitTyped"
		/>
	</div>
</template>

<style scoped>
.checkerboard {
	background-image:
		linear-gradient(45deg, #ccc 25%, transparent 25%), linear-gradient(-45deg, #ccc 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #ccc 75%), linear-gradient(-45deg, transparent 75%, #ccc 75%);
	background-size: 8px 8px;
	background-position:
		0 0,
		0 4px,
		4px -4px,
		-4px 0px;
}
</style>
