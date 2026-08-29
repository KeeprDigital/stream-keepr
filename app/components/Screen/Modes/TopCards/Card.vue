<script setup lang="ts">
import type { CardBreakdownEntry } from '~~/shared/types/metagame';

const props = defineProps<{
	entry: CardBreakdownEntry;
	rank: number;
	sizeClass: string;
	dynamicSize?: boolean;
	showName: boolean;
	showRank: boolean;
	rankBadgeClass: string;
	rankBadgeStyle: Record<string, string>;
	statText: string | null;
	statBadgeClass: string;
	statBadgeStyle: Record<string, string>;
}>();

const imageError = ref(false);

/**
 * Scryfall CDN URL for the card's normal front face image.
 * Format: https://cards.scryfall.io/normal/front/{char1}/{char2}/{uuid}.jpg
 */
const imageUrl = computed(() => {
	const id = props.entry.scryfallId;
	if (!id)
		return null;
	return `https://cards.scryfall.io/normal/front/${id[0]}/${id[1]}/${id}.jpg`;
});

watch(() => props.entry.scryfallId, () => {
	imageError.value = false;
});
</script>

<template>
	<div
		class="top-cards-item flex flex-col gap-1 min-w-0"
		:class="{ [sizeClass]: !dynamicSize }"
		data-testid="top-cards-item"
	>
		<div class="relative">
			<div class="aspect-63/88 rounded-lg overflow-hidden bg-elevated">
				<img
					v-if="imageUrl && !imageError"
					:src="imageUrl"
					:alt="entry.name"
					class="w-full h-full object-cover"
					loading="eager"
					@error="imageError = true"
				>
				<div v-else class="w-full h-full flex items-center justify-center text-xs text-center p-1">
					{{ entry.name }}
				</div>
			</div>
			<div
				v-if="showRank"
				data-testid="top-cards-rank-badge"
				class="absolute rounded-full font-bold flex items-center justify-center shadow-md"
				:class="rankBadgeClass"
				:style="rankBadgeStyle"
			>
				{{ rank }}
			</div>
			<div
				v-if="statText"
				data-testid="top-cards-stat-badge"
				class="absolute rounded-md font-mono font-bold leading-none shadow-md"
				:class="statBadgeClass"
				:style="statBadgeStyle"
			>
				{{ statText }}
			</div>
		</div>
		<div
			v-if="showName"
			data-testid="top-cards-name"
			class="top-cards-name text-center font-semibold truncate"
		>
			{{ entry.name }}
		</div>
	</div>
</template>
