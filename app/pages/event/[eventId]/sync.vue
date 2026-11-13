<script setup lang="ts">
import { EVENT_PAGE_OFFERED_TO } from '~~/shared/config/games';

/**
 * An Event's Sync page: Melee Sync on a Magic: The Gathering Event, the TCG+
 * Import on a One Piece Card Game Event (ADR-0074). Each draws its own layout.
 */
definePageMeta({
	offeredTo: EVENT_PAGE_OFFERED_TO.sync,
	title: 'Sync',
	layout: false,
	middleware: 'sync',
});

const eventStore = useEventStore();
</script>

<template>
	<SyncTcgPlusImport v-if="eventStore.event?.game === 'op'" />
	<SyncMelee v-else />
</template>
