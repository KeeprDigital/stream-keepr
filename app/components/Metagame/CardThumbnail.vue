<script setup lang="ts">
import { metagameCardImageUrl } from '~~/shared/utils/metagame';

const props = defineProps<{
	scryfallId: string | null;
	/** A One Piece card's standard Printing image, which it shows over any Scryfall face. */
	imageUrl?: string | null;
	name?: string;
	size?: 'sm' | 'md' | 'lg';
}>();

const imageError = ref(false);

const shownImageUrl = computed(() => metagameCardImageUrl(props));

const widthClass = computed(() => {
	switch (props.size) {
		case 'sm': return 'w-20';
		case 'lg': return 'w-44';
		default: return 'w-32';
	}
});

// Reset error when the image changes
watch(shownImageUrl, () => {
	imageError.value = false;
});
</script>

<template>
	<div
		class="mtg-card shrink-0"
		:class="[widthClass]"
	>
		<img
			v-if="shownImageUrl && !imageError"
			:src="shownImageUrl"
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
