<script setup lang="ts">
const props = defineProps<{
	scryfallId: string | null;
	name?: string;
	size?: 'sm' | 'md' | 'lg';
}>();

const imageError = ref(false);

/**
 * Scryfall CDN URL for the card's normal face image.
 * Format: https://cards.scryfall.io/normal/front/{char1}/{char2}/{uuid}.jpg
 */
const imageUrl = computed(() => {
	if (!props.scryfallId)
		return null;
	const id = props.scryfallId;
	return `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
});

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
		class="shrink-0"
		:class="[widthClass]"
		style="aspect-ratio: 61/85"
	>
		<img
			v-if="imageUrl && !imageError"
			:src="imageUrl"
			:alt="name ?? 'Card image'"
			class="w-full h-full object-cover rounded-lg"
			loading="lazy"
			@error="imageError = true"
		>
		<div
			v-else
			class="w-full h-full rounded-lg bg-elevated border border-default flex items-center justify-center"
		>
			<UIcon name="i-lucide-image-off" class="size-6 text-muted" />
		</div>
	</div>
</template>
