<script setup lang="ts">
const props = withDefaults(defineProps<{
	color?: string;
	gradient?: string;
	opacity?: number;
	colorLabel?: string;
	gradientLabel?: string;
	opacityLabel?: string;
	colorPlaceholder?: string;
	gradientPlaceholder?: string;
	allowRawColor?: boolean;
	emptyColorValue?: string;
}>(), {
	colorLabel: 'Base Color',
	gradientLabel: 'Gradient Overlay',
	opacityLabel: 'Opacity',
	colorPlaceholder: '#000000',
	gradientPlaceholder: 'linear-gradient(90deg, rgba(192,0,96,.9), rgba(111,0,255,.9))',
	allowRawColor: false,
	emptyColorValue: undefined,
});

const emit = defineEmits<{
	update: [updates: { color?: string; gradient?: string; opacity?: number }];
}>();

function updateColor(value: string | undefined) {
	const normalized = String(value || '').trim() || props.emptyColorValue;
	emit('update', { color: normalized });
}

function updateGradient(value: string | number | undefined) {
	emit('update', { gradient: String(value || '').trim() || undefined });
}

function updateOpacity(value: number | null | undefined) {
	emit('update', { opacity: Number(value ?? 0) });
}
</script>

<template>
	<div class="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
		<UFormField :label="colorLabel">
			<UIColorPicker
				:model-value="color"
				:placeholder="colorPlaceholder"
				:allow-raw-value="allowRawColor"
				@update:model-value="updateColor"
			/>
		</UFormField>
		<UFormField :label="opacityLabel">
			<UInputNumber
				:model-value="opacity ?? 0"
				:step="0.05"
				:min="0"
				:max="1"
				size="sm"
				class="w-full"
				@update:model-value="updateOpacity"
			/>
		</UFormField>
		<UFormField :label="gradientLabel" class="md:col-span-2 xl:col-span-3">
			<UInput
				:model-value="gradient ?? ''"
				:placeholder="gradientPlaceholder"
				size="sm"
				class="w-full"
				@update:model-value="updateGradient"
			/>
		</UFormField>
	</div>
</template>
