<script setup lang="ts">
import type { NavigationMenuItem } from '#ui/types';

const props = defineProps<{
	eventId: number;
}>();

const tabs = computed<NavigationMenuItem[]>(() => [
	{
		label: 'Event',
		icon: 'i-lucide-settings',
		to: `/event/${props.eventId}/config`,
		exact: true,
	},
	{ label: 'Event Structure', icon: 'i-lucide-list-ordered', to: `/event/${props.eventId}/rounds` },
	{ label: 'Feature Matches', icon: 'i-lucide-toggle-left', to: `/event/${props.eventId}/config/features` },
	{ label: 'Broadcast', icon: 'i-lucide-radio', to: `/event/${props.eventId}/config/broadcast` },
	{ label: 'Integrations', icon: 'i-lucide-plug', to: `/event/${props.eventId}/config/integrations` },
]);
</script>

<template>
	<UNavigationMenu
		highlight
		:items="tabs"
		class="border-b border-default px-4 sm:px-6"
	/>
</template>
