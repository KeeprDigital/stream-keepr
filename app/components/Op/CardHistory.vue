<script lang="ts" setup>
import type { OpScreenCard } from '~~/shared/types/card/op';

const emit = defineEmits<{
	(e: 'close'): void;
}>();

const cardStore = useCardStore();

function selectCard(card: OpScreenCard) {
	void cardStore.selectOpHistoryCard(card);
	emit('close');
}

function clearHistory() {
	cardStore.clearOpHistory();
	emit('close');
}
</script>

<template>
	<UModal
		title="History"
		:ui="{ content: 'sm:max-w-screen-xl' }"
		description="Select a card from your history to preview it"
	>
		<template #body>
			<div class="history">
				<div
					v-for="card in cardStore.opSelectionHistory"
					:key="card.id"
					class="flex flex-col gap-1"
				>
					<OpCardImage
						:card="card"
						selectable
						@selected="selectCard(card)"
					/>
					<div class="text-center">
						{{ card.name }}
					</div>
				</div>
			</div>
		</template>
		<template #footer>
			<UButton @click="clearHistory">
				Clear
			</UButton>
		</template>
	</UModal>
</template>

<style scoped>
.history {
	display: grid;
	grid-template-columns: repeat(5, 1fr);
	gap: 0.75rem;
}
</style>
