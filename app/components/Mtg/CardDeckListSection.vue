<script setup lang="ts">
import type { DeckListCardWithData, DeckListTokenWithData } from '~/types/card/deckList';

type DeckDisplayItem = DeckListCardWithData | DeckListTokenWithData;

const props = withDefaults(defineProps<{
	title: string;
	cards: DeckDisplayItem[];
	filter: string;
	defaultOpen?: boolean;
}>(), {
	defaultOpen: true,
});

const cardStore = useCardStore();

const filteredCards = computed(() => {
	if (!props.filter.trim())
		return props.cards;
	const search = props.filter.toLowerCase();
	return props.cards.filter(card => card.name.toLowerCase().includes(search));
});

const totalCount = computed(() => props.cards.reduce(
	(sum, card) => sum + ('quantity' in card ? card.quantity : 1),
	0,
));

const filteredCount = computed(() => filteredCards.value.reduce(
	(sum, card) => sum + ('quantity' in card ? card.quantity : 1),
	0,
));

const countLabel = computed(() => {
	if (props.filter.trim() && filteredCount.value !== totalCount.value)
		return `${filteredCount.value}/${totalCount.value}`;
	return String(totalCount.value);
});

const resolvedCards = computed(() =>
	filteredCards.value
		.filter(card => card.mtgCard != null)
		.map(card => card.mtgCard!),
);

const quantityMap = computed(() => {
	const map: Record<string, number> = {};
	for (const card of filteredCards.value) {
		if (card.mtgCard && 'quantity' in card)
			map[card.mtgCard.id] = card.quantity;
	}
	return map;
});

const pointsMap = computed(() => {
	const map: Record<string, number> = {};
	for (const card of filteredCards.value) {
		if (card.mtgCard && 'highlanderPoints' in card && card.highlanderPoints)
			map[card.mtgCard.id] = card.highlanderPoints;
	}
	return map;
});

const unresolvedCards = computed(() =>
	filteredCards.value.filter(card => card.mtgCard == null),
);
</script>

<template>
	<UCollapsible :default-open="defaultOpen" class="border-b border-default last:border-b-0">
		<template #default="{ open }">
			<button
				type="button"
				class="flex w-full items-center justify-between gap-3 py-3 text-left"
			>
				<div class="flex min-w-0 items-center gap-2">
					<h3 class="text-base font-semibold">
						{{ title }}
					</h3>
					<UBadge color="neutral" variant="soft" size="sm">
						{{ countLabel }}
					</UBadge>
				</div>
				<UIcon
					name="i-lucide-chevron-down"
					class="size-4 shrink-0 text-muted transition-transform"
					:class="{ 'rotate-180': open }"
				/>
			</button>
		</template>

		<template #content>
			<div class="pb-5">
				<MtgCardList
					v-if="filteredCards.length"
					:cards="resolvedCards"
					:quantities="quantityMap"
					:points="pointsMap"
					gap="1rem"
					@selected="cardStore.selectPreviewCard"
				/>

				<p v-else class="py-6 text-center text-sm text-muted">
					No cards match this filter.
				</p>

				<div v-if="unresolvedCards.length" class="unresolved-grid mt-4">
					<div v-for="card in unresolvedCards" :key="card.name" class="card-placeholder">
						<div class="placeholder-content">
							<span class="text-sm font-medium">{{ card.name }}</span>
							<span v-if="'highlanderPoints' in card && card.highlanderPoints" class="text-sm font-bold text-primary">{{ card.highlanderPoints }}</span>
							<span v-if="'quantity' in card" class="text-xs text-muted">{{ card.quantity }}x</span>
							<span v-if="'typeLine' in card && card.typeLine" class="text-xs text-muted">{{ card.typeLine }}</span>
							<span v-if="'scryfallId' in card && card.scryfallId" class="text-xs text-dimmed font-mono">{{ card.scryfallId }}</span>
						</div>
					</div>
				</div>
			</div>
		</template>
	</UCollapsible>
</template>

<style scoped>
.unresolved-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
	gap: 1rem;
}

.card-placeholder {
	aspect-ratio: 61/85;
	background: var(--ui-bg-elevated);
	border-radius: 4.75%;
	display: flex;
	align-items: center;
	justify-content: center;
	border: 2px dashed var(--ui-border);
}

.placeholder-content {
	display: flex;
	flex-direction: column;
	align-items: center;
	text-align: center;
	padding: 1rem;
}
</style>
