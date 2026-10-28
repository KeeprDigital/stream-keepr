<script setup lang="ts">
import { scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';

const props = defineProps<{
	scryfallId: string | null;
	name?: string;
	size?: 'sm' | 'md' | 'lg';
}>();

const imageError = ref(false);

const imageUrl = computed(() => scryfallCardImageUrl(props.scryfallId));

const widthClass = computed(() => {
	switch (props.size) {
		case 'sm': return 'w-20';
		case 'lg': return 'w-44';
		default: return 'w-32';
	}
});

// Reset error when scryfallId changes
watch(() => props.scryfallId, () => {
	imageError.value = false;
});
</script>

<template>
	<div
		class="mtg-card shrink-0"
		:class="[widthClass]"
	>
		<img
			v-if="imageUrl && !imageError"
			:src="imageUrl"
			:alt="name ?? 'Card image'"
			class="w-full h-full object-cover"
			loading="lazy"
			@error="imageError = true"
		>
		<div
			v-else
			class="w-full h-full bg-elevated border border-default flex items-center justify-center"
		>
			<UIcon name="i-lucide-image-off" class="size-6 text-muted" />
		</div>
	</div>
</template>
