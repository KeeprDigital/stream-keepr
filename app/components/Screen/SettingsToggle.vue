<script setup lang="ts">
const props = withDefaults(defineProps<{
	label: string;
	description?: string;
	/** Description shown when the toggle is disabled via the `enabled` prop. */
	disabledDescription?: string;
	/**
	 * Feature gate — when `false`, the toggle is disabled and the description
	 * swaps to `disabledDescription`. The emitted value is also gated so the
	 * bound config never becomes `true` while the feature is off.
	 */
	enabled?: boolean;
}>(), {
	enabled: undefined,
});

const model = defineModel<boolean | undefined>({ required: true });

const isFeatureGated = computed(() => props.enabled !== undefined);
const isDisabled = computed(() => isFeatureGated.value && !props.enabled);

const resolvedDescription = computed(() => {
	if (isDisabled.value && props.disabledDescription) {
		return props.disabledDescription;
	}
	return props.description;
});

const resolvedValue = computed(() => {
	if (isDisabled.value)
		return false;
	return model.value ?? true;
});

function onUpdate(value: boolean) {
	if (isDisabled.value)
		return;
	model.value = value;
}
</script>

<template>
	<div>
		<UFormField
			:label="label"
			:description="resolvedDescription"
			class="flex max-sm:flex-col justify-between gap-4 items-center"
		>
			<USwitch
				:model-value="resolvedValue"
				:disabled="isDisabled"
				@update:model-value="onUpdate"
			/>
		</UFormField>
		<div v-if="$slots.default" class="mt-3">
			<slot />
		</div>
	</div>
</template>
