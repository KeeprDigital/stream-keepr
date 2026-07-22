<script setup lang="ts">
import type { CardResponse } from '~~/shared/types/metagame';

defineProps<{
	cards: CardResponse[];
	eventId: number;
}>();
</script>

<template>
	<div v-if="cards.length === 0" class="text-sm text-muted">
		No key cards set
	</div>
	<div v-else class="flex gap-4 flex-wrap">
		<NuxtLink
			v-for="card in cards"
			:key="card.id"
			:to="`/event/${eventId}/metagame/card/${card.id}`"
			class="group flex flex-col items-center gap-1.5"
		>
			<MetagameCardThumbnail
				:scryfall-id="card.scryfallId"
				:name="card.name"
				size="md"
				class="group-hover:opacity-90 transition-opacity"
			/>
			<span class="text-xs text-center text-muted group-hover:text-highlighted transition-colors w-32 truncate">
				{{ card.name }}
			</span>
		</NuxtLink>
	</div>
</template>
