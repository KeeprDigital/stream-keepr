<script setup lang="ts">
import type { CardBreakdownEntry } from '~~/shared/types/metagame';
import { scryfallCardImageUrl } from '~~/shared/utils/scryfallCardImage';

/**
 * One ranked card, for any Screen Mode that shows one. Its look comes from the
 * host mode's Mode Tokens through the style props, since a mode's tokens are
 * set only while it is the Screen's mode; a host passing none leaves its own
 * look showing through.
 */
const props = defineProps<{
	entry: CardBreakdownEntry;
	rank: number;
	/** The card's width while its sizing is fixed. */
	width?: string;
	/** Fixed takes `width`; fill takes its grid column's width; fit fits its grid cell both ways. */
	sizing: 'fixed' | 'fill' | 'fit';
	/** A name label under the card, for a host whose cards want one. */
	showName: boolean;
	showRank: boolean;
	/** Each badge's place on the card, and its look, text size included; it sizes itself around its text. */
	rankBadgeClass: string;
	rankBadgeStyle: Record<string, string>;
	statText: string | null;
	statBadgeClass: string;
	statBadgeStyle: Record<string, string>;
	/** The card's points, for a host that badges them; `null` or absent shows no badge. */
	pointsText?: string | null;
	pointsBadgeClass?: string;
	pointsBadgeStyle?: Record<string, string>;
	/** The card's face, which shows when it has no image. */
	cardStyle?: Record<string, string>;
}>();

const imageError = ref(false);

const imageUrl = computed(() => scryfallCardImageUrl(props.entry.scryfallId));

watch(() => props.entry.scryfallId, () => {
	imageError.value = false;
});
</script>

<template>
	<div
		class="top-cards-item flex flex-col gap-1 min-w-0"
		:class="{ 'min-h-0': sizing === 'fit' }"
		:style="sizing === 'fixed' ? { width } : undefined"
		:data-sizing="sizing"
		data-testid="top-cards-item"
	>
		<div class="relative">
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
			<div
				v-if="pointsText"
				data-testid="top-cards-points-badge"
				class="absolute rounded-md tabular-nums"
				:class="pointsBadgeClass"
				:style="pointsBadgeStyle"
			>
				{{ pointsText }}
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
