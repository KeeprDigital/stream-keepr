<script setup lang="ts">
import FeatureMatchOverlayControlSection from './ControlSection.vue';

defineProps<{
	zIndex: number;
}>();

const emit = defineEmits<{
	sendToBack: [];
	move: [delta: 1 | -1];
	bringToFront: [];
	updateZIndex: [zIndex: number];
}>();
</script>

<template>
	<FeatureMatchOverlayControlSection
		title="Order"
		:summary="`z-index ${zIndex}`"
	>
		<div class="space-y-3">
			<div class="grid gap-2 sm:grid-cols-4">
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-send-to-back"
					@click="emit('sendToBack')"
				>
					Back
				</UButton>
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-chevron-down"
					@click="emit('move', -1)"
				>
					Backward
				</UButton>
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-chevron-up"
					@click="emit('move', 1)"
				>
					Forward
				</UButton>
				<UButton
					size="sm"
					variant="soft"
					icon="i-lucide-bring-to-front"
					@click="emit('bringToFront')"
				>
					Front
				</UButton>
			</div>
			<UFormField label="Order value">
				<UInputNumber
					:model-value="zIndex"
					size="sm"
					class="w-full"
					@update:model-value="emit('updateZIndex', Number($event))"
				/>
			</UFormField>
		</div>
	</FeatureMatchOverlayControlSection>
</template>
