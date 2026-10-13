<script setup lang="ts">
/**
 * The one input for an opacity: 0 (clear) to 1 (opaque) in steps of 0.05.
 * A cleared field emits `null`; what that means — fully opaque, fully clear, or
 * unchanged — is the owner's to decide. Size, labels, and test ids fall through
 * to the input.
 */
const model = defineModel<number | null | undefined>({ required: true });
</script>

<template>
	<UInputNumber
		v-model="model"
		:min="0"
		:max="1"
		:step="0.05"
	/>
</template>
