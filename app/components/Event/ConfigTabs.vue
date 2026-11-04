<script setup lang="ts">
import type { Game } from '~~/shared/types/enums';
import type { NavigationMenuItem } from '#ui/types';
import { EVENT_PAGE_CARD_GAMES, EVERY_CARD_GAME, offeredToCardGame } from '~~/shared/config/games';

const props = defineProps<{
	eventId: number;
}>();

const eventStore = useEventStore();

/** A settings tab, declaring the Card Games whose Events it is offered to (ADR-0057). */
interface ConfigTab extends NavigationMenuItem {
	cardGames: readonly Game[];
}

const tabs = computed<NavigationMenuItem[]>(() => offeredToCardGame<ConfigTab>([
	{
		label: 'Event',
		icon: 'i-lucide-settings',
		to: `/event/${props.eventId}/config`,
		exact: true,
		cardGames: EVERY_CARD_GAME,
	},
	{
		label: 'Event Structure',
		icon: 'i-lucide-list-ordered',
		to: `/event/${props.eventId}/rounds`,
		cardGames: EVENT_PAGE_CARD_GAMES.eventStructure,
	},
	{
		label: 'Feature Matches',
		icon: 'i-lucide-toggle-left',
		to: `/event/${props.eventId}/config/features`,
		cardGames: EVERY_CARD_GAME,
	},
	{
		label: 'Broadcast',
		icon: 'i-lucide-radio',
		to: `/event/${props.eventId}/config/broadcast`,
		cardGames: EVERY_CARD_GAME,
	},
	{
		label: 'Integrations',
		icon: 'i-lucide-plug',
		to: `/event/${props.eventId}/config/integrations`,
		cardGames: EVENT_PAGE_CARD_GAMES.integrations,
	},
], eventStore.event?.game));
</script>

<template>
	<UNavigationMenu
		highlight
		:items="tabs"
		class="border-b border-default px-4 sm:px-6"
	/>
</template>
