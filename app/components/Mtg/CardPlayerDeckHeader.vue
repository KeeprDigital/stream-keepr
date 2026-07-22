<script setup lang="ts">
import { getMtgGameData } from '~~/shared/utils/gameData';

const cardStore = useCardStore();
const playerStore = usePlayerStore();

const selectedPlayerId = defineModel<number | undefined>('playerId');

// Players with deck lists (deckName in gameData is the proxy for having a deck)
const playersWithDecks = computed(() => {
	return playerStore.players.filter(p => getMtgGameData(p.gameData).deckName);
});

const playerOptions = computed(() => {
	return playersWithDecks.value.map((p) => {
		const deck = getMtgGameData(p.gameData);
		return {
			label: p.name,
			value: p.id,
			deckName: deck.deckName,
			colors: deck.deckColors,
		};
	});
});

// When player selection changes
watch(selectedPlayerId, async (playerId) => {
	if (playerId) {
		await cardStore.loadPlayerDeck(playerId);
	}
	else {
		cardStore.clearPlayerDeck();
	}
});
</script>

<template>
	<div class="flex items-center gap-4">
		<!-- Player Picker -->
		<USelectMenu
			v-model="selectedPlayerId"
			:items="playerOptions"
			value-key="value"
			placeholder="Select player..."
			clear
			size="xl"
			class="w-72"
			:ui="{ content: 'min-w-fit' }"
			@clear="selectedPlayerId = undefined"
		>
			<template #item-label="{ item }">
				<div class="flex flex-col gap-0.5">
					<span class="font-medium">{{ item.label }}</span>
					<div v-if="item.deckName" class="flex items-center gap-1 text-xs text-muted">
						<MtgManaColorDisplay v-if="item.colors" :colors="item.colors" size="xs" />
						<span>{{ item.deckName }}</span>
					</div>
				</div>
			</template>
		</USelectMenu>

		<!-- Filter Input -->
		<UInput
			v-if="cardStore.playerDeckHasData"
			v-model="cardStore.deckListFilter"
			size="xl"
			placeholder="Filter cards..."
			icon="i-lucide-filter"
			class="flex-1"
		>
			<template v-if="cardStore.deckListFilter" #trailing>
				<UButton
					color="neutral"
					variant="link"
					size="sm"
					icon="i-lucide-x"
					aria-label="Clear filter"
					@click="() => { cardStore.deckListFilter = '' }"
				/>
			</template>
		</UInput>
	</div>
</template>
