<script setup lang="ts">
import type { CardBreakdownEntry } from '~~/shared/types/metagame';

/**
 * One ranked card, for any Screen Mode that shows one. Its look comes from the
 * host mode's Mode Tokens through the style props, since a mode's tokens are
 * set only while it is the Screen's mode; a host passing none leaves its own
 * look showing through.
 */
const props = defineProps<{
	entry: CardBreakdownEntry;
	rank: number;
	/** The card's width, unless it fills its grid column. */
	width?: string;
	dynamicSize?: boolean;
	showName: boolean;
	showRank: boolean;
	rankBadgeClass: string;
	rankBadgeStyle: Record<string, string>;
	statText: string | null;
	statBadgeClass: string;
	statBadgeStyle: Record<string, string>;
	/** The badges' text size, which each badge sizes itself around. */
	badgeSize?: string;
	/** The card's face, which shows when it has no image. */
	cardStyle?: Record<string, string>;
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
		:style="dynamicSize ? undefined : { width }"
		data-testid="top-cards-item"
	>
		<div class="relative" :style="badgeSize ? { fontSize: badgeSize } : undefined">
			<div class="mtg-card" :style="cardStyle">
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
				class="absolute rounded-full flex items-center justify-center"
				:class="rankBadgeClass"
				:style="rankBadgeStyle"
			>
				{{ rank }}
			</div>
			<div
				v-if="statText"
				data-testid="top-cards-stat-badge"
				class="absolute rounded-md tabular-nums"
				:class="statBadgeClass"
				:style="statBadgeStyle"
			>
				{{ statText }}
			</div>
		</div>
		<div
			v-if="showName"
			data-testid="top-cards-name"
			class="top-cards-name text-center truncate"
		>
			{{ entry.name }}
		</div>
	</div>
</template>
