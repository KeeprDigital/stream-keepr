<script setup lang="ts">
import type { NavigationMenuItem } from '#ui/types';

definePageMeta({
	title: 'Metagame',
	layout: false,
});

const eventStore = useEventStore();
const playerListStore = usePlayerListStore();
const metagameStore = useMetagameStore();

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
						:conversion-metric="metagameStore.conversionMetric"
						:conversion-threshold="metagameStore.conversionThreshold"
						@update:conversion-metric="metagameStore.conversionMetric = $event"
						@update:conversion-threshold="metagameStore.conversionThreshold = $event"
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
