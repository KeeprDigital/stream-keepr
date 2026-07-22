<script setup lang="ts">
import type { DeckListCard } from '~~/shared/types/deckList';
import type { MtgCard } from '~/types/card/mtg';

const props = defineProps<{
	cards: DeckListCard[];
	cardDataMap: Map<string, MtgCard>;
	compartmentLabel: string;
	totalCount: number;
	/** Set of card names currently marked as key cards */
	selectedKeyCards?: Set<string>;
	/** Whether click-to-select key card mode is enabled */
	selectable?: boolean;
}>();

const emit = defineEmits<{
	(e: 'toggleKeyCard', name: string): void;
}>();

function getImageUrl(card: DeckListCard): string | null {
	const mtgCard = card.scryfallId
		? props.cardDataMap.get(card.scryfallId) ?? null
		: props.cardDataMap.get(`name:${card.name.toLowerCase()}`) ?? null;
	return mtgCard?.imageData?.front?.normal ?? null;
}

function isKeyCard(name: string): boolean {
	return props.selectedKeyCards?.has(name) ?? false;
}

function handleClick(name: string) {
	if (props.selectable) {
		emit('toggleKeyCard', name);
	}
}
</script>

<template>
	<div>
		<h4 class="font-semibold mb-3 text-xs uppercase tracking-wide text-muted">
			{{ compartmentLabel }} ({{ totalCount }})
		</h4>
		<div class="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
			<div
				v-for="card in cards"
				:key="card.name"
				class="relative group"
				:class="selectable ? 'cursor-pointer' : ''"
				@click="handleClick(card.name)"
			>
				<!-- Card image -->
				<div
					class="aspect-[63/88] rounded-lg overflow-hidden border-2 transition-all duration-150"
					:class="[
						isKeyCard(card.name)
							? 'border-primary ring-2 ring-primary/30'
							: 'border-transparent hover:border-muted',
					]"
				>
					<NuxtImg
						v-if="getImageUrl(card)"
						:src="getImageUrl(card)!"
						:alt="card.name"
						width="244"
						height="340"
						class="w-full h-full object-cover"
						loading="lazy"
					/>
					<!-- Fallback when no image -->
					<div
						v-else
						class="w-full h-full bg-elevated flex items-center justify-center p-2"
					>
						<span class="text-xs text-muted text-center leading-tight">{{ card.name }}</span>
					</div>
				</div>

				<!-- Quantity badge -->
				<div class="absolute top-1 left-1 bg-black/70 text-white text-xs font-mono font-bold rounded px-1.5 py-0.5 leading-none">
					{{ card.quantity }}
				</div>

				<div v-if="card.highlanderPoints" class="absolute bottom-1 right-1 bg-primary text-white text-sm font-mono font-bold rounded-md px-2.5 py-1 leading-none shadow-md">
					{{ card.highlanderPoints }}
				</div>

				<!-- Key card star -->
				<div
					v-if="isKeyCard(card.name)"
					class="absolute top-1 right-1 bg-primary text-white rounded-full p-0.5"
				>
					<UIcon name="i-lucide-star" class="size-3" />
				</div>
			</div>
		</div>
	</div>
</template>
