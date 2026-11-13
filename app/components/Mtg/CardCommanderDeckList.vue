<script setup lang="ts">
import { seatNumber } from '~~/shared/utils/featureMatchSidePlayer';

/**
 * The Cards page's Feature Match Deck Lists on a Commander Event (ADR-0087):
 * the picked Slot's Seats, each with its Commanders apart from the Mainboard
 * of the list it holds. Choosing a card previews it on Card Spotlight.
 */
const cardStore = useCardStore();
</script>

<template>
	<div class="min-h-full">
		<UILoadingSpinner v-if="cardStore.loadingDeckList" size="sm" label="Loading deck lists..." />

		<UIEmptyState
			v-else-if="!cardStore.deckListHasData"
			variant="inline"
			icon="i-lucide-layers"
			title="Select a Feature Match Slot to view its Seats"
		/>

		<!-- A column a Seat, in Seat order: two abreast, as the matchup's two are. -->
		<div v-else class="grid min-h-full grid-cols-1 items-start gap-6 lg:grid-cols-2">
			<section
				v-for="seated in cardStore.commanderDeckListSeats"
				:key="seated.seat"
				class="flex flex-col"
				:data-seat="seated.seat"
			>
				<div class="mb-3 flex items-center gap-2 px-1" data-seat-heading>
					<span class="text-sm font-medium text-muted">Seat {{ seatNumber(seated.seat) }}</span>
					<span class="truncate text-lg font-semibold">{{ seated.playerName }}</span>
					<span v-if="seated.deckName" class="truncate text-muted">{{ seated.deckName }}</span>
					<MtgManaColorDisplay v-if="seated.deckColors" :colors="seated.deckColors" size="sm" />
				</div>

				<MtgCardDeckListSection
					v-if="seated.commanders.length"
					:title="seated.commanders.length === 1 ? 'Commander' : 'Commanders'"
					:cards="seated.commanders"
					:filter="cardStore.deckListFilter"
					:default-open="true"
				/>
				<MtgCardDeckListSection
					v-if="seated.mainboard.length"
					title="Mainboard"
					:cards="seated.mainboard"
					:filter="cardStore.deckListFilter"
					:default-open="true"
				/>
				<UIEmptyState
					v-else
					variant="inline"
					icon="i-lucide-layers"
					:title="seated.failed ? 'Deck List could not be loaded' : 'No Deck List'"
				/>
			</section>
		</div>
	</div>
</template>
