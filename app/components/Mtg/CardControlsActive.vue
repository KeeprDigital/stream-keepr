<script lang="ts" setup>
import { isOpScreenCard } from '~~/shared/utils/card/op';

const cardStore = useCardStore();

const { activeCard } = storeToRefs(cardStore);
</script>

<template>
	<transition mode="out-in" name="cross-fade">
		<div v-if="activeCard" :key="activeCard.id">
			<OpCardImage
				v-if="isOpScreenCard(activeCard)"
				:card="activeCard"
			/>
			<MtgCardImage
				v-else
				:card="activeCard"
				:display="activeCard.displayData"
				display-mode="output"
			/>
			<UButton
				color="warning"
				variant="outline"
				block
				@click="cardStore.controlActiveCard('clear')"
			>
				{{ cardStore.timeout.isActive ? `Clear (${cardStore.timeout.remaining}s)` : 'Clear' }}
			</UButton>
		</div>
	</transition>
</template>

<style scoped>
.cross-fade-enter-active,
.cross-fade-leave-active {
	transition: opacity 0.5s ease;
}

.cross-fade-enter-from,
.cross-fade-leave-to {
	opacity: 0;
}
</style>
