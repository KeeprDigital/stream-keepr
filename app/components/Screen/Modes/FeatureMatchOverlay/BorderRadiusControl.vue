<script setup lang="ts">
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
		<UFormField label="Top Left" class="md:col-start-1 md:row-start-1">
			<UInputNumber
				:model-value="valueFor('borderRadiusTopLeft')"
				size="sm"
				class="w-full"
				@update:model-value="emit('update', 'borderRadiusTopLeft', Number($event))"
			/>
		</UFormField>

		<UFormField label="All Corners" class="md:col-start-2 md:row-span-2 md:row-start-1">
			<UInputNumber
				:model-value="valueFor('borderRadius')"
				size="sm"
				class="w-full"
				@update:model-value="emit('update', 'borderRadius', Number($event))"
			/>
		</UFormField>

		<UFormField label="Top Right" class="md:col-start-3 md:row-start-1">
			<UInputNumber
				:model-value="valueFor('borderRadiusTopRight')"
				size="sm"
				class="w-full"
				@update:model-value="emit('update', 'borderRadiusTopRight', Number($event))"
			/>
		</UFormField>

		<UFormField label="Bottom Left" class="md:col-start-1 md:row-start-2">
			<UInputNumber
				:model-value="valueFor('borderRadiusBottomLeft')"
				size="sm"
				class="w-full"
				@update:model-value="emit('update', 'borderRadiusBottomLeft', Number($event))"
			/>
		</UFormField>

		<UFormField label="Bottom Right" class="md:col-start-3 md:row-start-2">
			<UInputNumber
				:model-value="valueFor('borderRadiusBottomRight')"
				size="sm"
				class="w-full"
				@update:model-value="emit('update', 'borderRadiusBottomRight', Number($event))"
			/>
		</UFormField>
	</div>
</template>
