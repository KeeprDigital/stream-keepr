<script setup lang="ts">
import type { AnimationEffectSelection } from '~~/shared/animationEffects';

// An Animation Effect token: an effect from the closed vocabulary and its
// params, edited with the shared Animation Effect editor, which emits on every
// keystroke.

defineProps<{
	modelValue: AnimationEffectSelection;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: AnimationEffectSelection];
}>();
</script>

<template>
	<div data-token-part="animation-effect" :aria-label="`${label} effect`" role="group">
		<ScreenAnimationEffectFields
			:selection="modelValue"
			@update:selection="value => emit('commit', value)"
		/>
	</div>
</template>
