<script setup lang="ts">
/**
 * The one toggle row of a settings surface. A toggle that cannot have an effect
 * is not rendered (#1060), so it is never shown disabled. Unset reads as on.
 */
defineProps<{
	label: string;
	description?: string;
}>();

const model = defineModel<boolean | undefined>({ required: true });
</script>

<template>
	<div>
		<ScreenSettingsField
			:label="label"
			:description="description"
			align="center"
		>
			<USwitch
				:model-value="model ?? true"
				@update:model-value="model = $event"
			/>
		</ScreenSettingsField>
		<div v-if="$slots.default" class="mt-3">
			<slot />
		</div>
	</div>
</template>
