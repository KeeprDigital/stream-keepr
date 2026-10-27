<script setup lang="ts">
const eventStore = useEventStore();

const event = computed(() => eventStore.event!);
const loading = computed(() => eventStore.loading);
</script>

<template>
	<div class="flex flex-col gap-6">
		<h2 class="text-xl font-semibold">
			Presentation
		</h2>
		<EventPresentationSettings :event="event" :loading="loading" />

		<h2 class="text-xl font-semibold">
			Card Spotlight
		</h2>
		<EventConfigCardSpotlight :event="event" :loading="loading" />

		<h2 class="text-xl font-semibold">
			Talents
		</h2>
		<EventConfigTalents :talents="event.talents" />

		<EventBroadcastDeckListLibrary :event="event" />
	</div>
</template>
