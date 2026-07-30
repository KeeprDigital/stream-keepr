<script setup lang="ts">
import FeatureMatchOverlayControlSection from './ControlSection.vue';

const emit = defineEmits<{
	sendToBack: [];
	move: [delta: 1 | -1];
	bringToFront: [];
}>();
</script>

<template>
	<FeatureMatchOverlayControlSection
		title="Order"
		summary="Back-to-front list"
	>
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
	</FeatureMatchOverlayControlSection>
</template>
