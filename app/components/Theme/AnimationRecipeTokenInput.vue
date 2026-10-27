<script setup lang="ts">
import type { GraphicAnimationChannelKey, GraphicAnimationChannels } from '~~/shared/modules/graphics';
import type { GraphicAnimationRecipe } from '~~/shared/types/graphics';
import { mergeGraphicAnimationRecipeChannel } from '~~/shared/modules/graphics';

// A Graphic Animation Recipe token: timing, easing and channels. It has no
// owner to measure a slide against, so a fixed distance is in pixels.

const props = defineProps<{
	modelValue: GraphicAnimationRecipe;
	label: string;
}>();

const emit = defineEmits<{
	commit: [value: GraphicAnimationRecipe];
}>();

function update(patch: Partial<Pick<GraphicAnimationRecipe, 'duration' | 'easing' | 'delay'>>) {
	emit('commit', {
		...props.modelValue,
		...patch,
	});
}

function channel<K extends GraphicAnimationChannelKey>(key: K, patch: Partial<GraphicAnimationChannels[K]> | null) {
	emit('commit', mergeGraphicAnimationRecipeChannel(props.modelValue, key, patch));
}
</script>

<template>
	<GraphicsAnimationRecipeFields
		:recipe="modelValue"
		test-id-prefix="theme-animation"
		@update="update"
		@channel="channel"
	/>
</template>
