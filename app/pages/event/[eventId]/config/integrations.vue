<script setup lang="ts">
import { EVENT_PAGE_CARD_GAMES } from '~~/shared/config/games';

definePageMeta({
	cardGames: EVENT_PAGE_CARD_GAMES.integrations,
});

const eventStore = useEventStore();

const event = computed(() => eventStore.event!);
</script>

<template>
	<div class="flex flex-col gap-6">
		<h2 class="text-xl font-semibold">
			Melee.gg
		</h2>
		<EventConfigMeleeIntegration :event-id="event.id" />
	</div>
</template>
