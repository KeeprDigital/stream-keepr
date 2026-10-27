<script setup lang="ts">
import type { AnimationEffectSelection } from '~~/shared/animationEffects';
import { useThemeTokenDraft } from '~/modules/theme-editor/draft';

// An Animation Effect token: an effect from the closed vocabulary and its
// params, edited with the shared Animation Effect editor.

const props = defineProps<{
	modelValue: AnimationEffectSelection;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: AnimationEffectSelection];
}>();

const { draft, edit } = useThemeTokenDraft(() => props.modelValue, value => emit('commit', value));
</script>

<template>
	<div data-token-part="animation-effect" :aria-label="`${label} effect`" role="group">
		<ScreenAnimationEffectFields
			:selection="draft"
			:presets="false"
			@update:selection="edit"
		/>
	</div>
</template>
