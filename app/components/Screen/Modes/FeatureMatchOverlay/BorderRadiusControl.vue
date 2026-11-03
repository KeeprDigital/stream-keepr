<script setup lang="ts">
import { MAX_PIXEL_VALUE } from '~~/shared/types/graphics';

type RadiusField = 'borderRadius' | 'borderRadiusTopLeft' | 'borderRadiusTopRight' | 'borderRadiusBottomRight' | 'borderRadiusBottomLeft';

const props = defineProps<{
	borderRadius?: number;
	borderRadiusTopLeft?: number;
	borderRadiusTopRight?: number;
	borderRadiusBottomRight?: number;
	borderRadiusBottomLeft?: number;
}>();

const emit = defineEmits<{
	update: [field: RadiusField, value: number];
}>();

function valueFor(field: RadiusField) {
	return props[field] ?? props.borderRadius ?? 0;
}
</script>

<template>
	<div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
		<GraphicsNumberField
			label="Top Left"
			class="md:col-start-1 md:row-start-1"
			:model-value="valueFor('borderRadiusTopLeft')"
			:min="0"
			:max="MAX_PIXEL_VALUE"
			size="sm"
			@update:model-value="emit('update', 'borderRadiusTopLeft', Number($event))"
		/>

		<GraphicsNumberField
			label="All Corners"
			class="md:col-start-2 md:row-span-2 md:row-start-1"
			:model-value="valueFor('borderRadius')"
			:min="0"
			:max="MAX_PIXEL_VALUE"
			size="sm"
			@update:model-value="emit('update', 'borderRadius', Number($event))"
		/>

		<GraphicsNumberField
			label="Top Right"
			class="md:col-start-3 md:row-start-1"
			:model-value="valueFor('borderRadiusTopRight')"
			:min="0"
			:max="MAX_PIXEL_VALUE"
			size="sm"
			@update:model-value="emit('update', 'borderRadiusTopRight', Number($event))"
		/>

		<GraphicsNumberField
			label="Bottom Left"
			class="md:col-start-1 md:row-start-2"
			:model-value="valueFor('borderRadiusBottomLeft')"
			:min="0"
			:max="MAX_PIXEL_VALUE"
			size="sm"
			@update:model-value="emit('update', 'borderRadiusBottomLeft', Number($event))"
		/>

		<GraphicsNumberField
			label="Bottom Right"
			class="md:col-start-3 md:row-start-2"
			:model-value="valueFor('borderRadiusBottomRight')"
			:min="0"
			:max="MAX_PIXEL_VALUE"
			size="sm"
			@update:model-value="emit('update', 'borderRadiusBottomRight', Number($event))"
		/>
	</div>
</template>
