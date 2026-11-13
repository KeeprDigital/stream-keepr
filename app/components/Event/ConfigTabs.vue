<script setup lang="ts">
import type { EventKind } from '~~/shared/config/games';
import type { NavigationMenuItem } from '#ui/types';
import { EVENT_PAGE_OFFERED_TO, EVERY_EVENT, itemsOfferedToEvent } from '~~/shared/config/games';

const props = defineProps<{
	eventId: number;
}>();

const kind = useEventKind();

/** A settings tab, declaring the kinds of Event it is offered to (ADR-0057, ADR-0086). */
interface ConfigTab extends NavigationMenuItem {
	offeredTo: readonly EventKind[];
}

const tabs = computed<NavigationMenuItem[]>(() => itemsOfferedToEvent<ConfigTab>([
	{
		label: 'Event',
		icon: 'i-lucide-settings',
		to: `/event/${props.eventId}/config`,
		exact: true,
		offeredTo: EVERY_EVENT,
	},
	{
		label: 'Event Structure',
		icon: 'i-lucide-list-ordered',
		to: `/event/${props.eventId}/rounds`,
		offeredTo: EVENT_PAGE_OFFERED_TO.eventStructure,
	},
	{
		label: 'Feature Matches',
		icon: 'i-lucide-toggle-left',
		to: `/event/${props.eventId}/config/features`,
		offeredTo: EVERY_EVENT,
	},
	{
		label: 'Broadcast',
		icon: 'i-lucide-radio',
		to: `/event/${props.eventId}/config/broadcast`,
		offeredTo: EVERY_EVENT,
	},
	{
		label: 'Integrations',
		icon: 'i-lucide-plug',
		to: `/event/${props.eventId}/config/integrations`,
		offeredTo: EVENT_PAGE_OFFERED_TO.integrations,
	},
], kind.value));
</script>

<template>
	<UNavigationMenu
		highlight
		:items="tabs"
		class="border-b border-default px-4 sm:px-6"
	/>
</template>
