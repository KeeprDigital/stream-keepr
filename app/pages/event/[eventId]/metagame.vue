<script setup lang="ts">
import type { ConversionTarget } from '~~/shared/conversionTarget';
import type { NavigationMenuItem } from '#ui/types';
import { MTG_ONLY } from '~~/shared/config/games';
import { useConsumedEventData } from '~/modules/event-data/resync';

definePageMeta({
	cardGames: MTG_ONLY,
	title: 'Metagame',
	layout: false,
});

const eventStore = useEventStore();
const playerListStore = usePlayerListStore();
const metagameStore = useMetagameStore();
const { runRequest } = useRequestFeedback();

const isMtg = computed(() => eventStore.event?.game === 'mtg');
const eventId = computed(() => eventStore.eventId ?? 0);

const route = useRoute();

const tabs = computed<NavigationMenuItem[]>(() => {
	const base = `/event/${eventId.value}/metagame`;
	const path = route.path;

	const items: NavigationMenuItem[] = [
		{
			label: 'Archetypes',
			to: base,
			exact: true,
			active: path === base || path.startsWith(`${base}/archetype`),
		},
	];
	if (isMtg.value) {
		items.push({
			label: 'Cards',
			to: `${base}/cards`,
			active: path === `${base}/cards` || path.startsWith(`${base}/card`),
		}, {
			label: 'Tokens',
			to: `${base}/tokens`,
			active: path === `${base}/tokens`,
		});
	}
	return items;
});

useConsumedEventData(['playerLists']);

/**
 * Write the Event's Conversion Target (ADR-0061). The Event write is announced,
 * so every Metagame and Archetype Spotlight Screen Output re-reads; this page
 * re-reads on the pending target and returns to the stored one if refused.
 */
async function saveConversionTarget(target: ConversionTarget) {
	if (!eventStore.event)
		return;
	await runRequest(
		() => eventStore.updateEvent(target),
		{
			latestKey: 'conversion-target',
			success: false,
			error: () => ({ title: 'Failed to save the conversion target', description: eventStore.error ?? undefined, color: 'error' }),
		},
	);
}

onMounted(async () => {
	if (eventId.value && !playerListStore.isLoaded) {
		await playerListStore.loadByEventId(eventId.value);
	}
});
</script>

<template>
	<NuxtLayout name="default">
		<template #toolbar>
			<UDashboardToolbar>
				<template #left>
					<UNavigationMenu highlight :items="tabs" />
				</template>
				<template #right>
					<MetagameConversionControl
						v-bind="metagameStore.conversionQuery"
						@update="saveConversionTarget"
					/>
					<MetagameScopeControl
						:scope="metagameStore.scope"
						:top-n="metagameStore.topN"
						:min-points="metagameStore.minPoints"
						:player-list-id="metagameStore.playerListId"
						:player-lists="playerListStore.lists"
						@update:scope="metagameStore.scope = $event"
						@update:top-n="metagameStore.topN = $event"
						@update:min-points="metagameStore.minPoints = $event"
						@update:player-list-id="metagameStore.playerListId = $event"
					/>
				</template>
			</UDashboardToolbar>
		</template>

		<NuxtPage />
	</NuxtLayout>
</template>
