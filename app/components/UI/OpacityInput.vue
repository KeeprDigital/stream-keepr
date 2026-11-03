<script setup lang="ts">
import { OPACITY_INPUT } from '~/utils/opacityInput';

/**
 * The one input for an opacity: 0 (clear) to 1 (opaque) in steps of 0.05.
 * A cleared field emits `null`; what that means — fully opaque, fully clear, or
 * unchanged — is the owner's to decide. Size, labels, and test ids fall through
 * to the input. A graphics inspector labels its opacity with a
 * `GraphicsNumberField` bound to the same `OPACITY_INPUT` instead.
 */
const model = defineModel<number | null | undefined>({ required: true });
</script>

<template>
	<UInputNumber
		v-model="model"
		v-bind="OPACITY_INPUT"
	/>
</template>
