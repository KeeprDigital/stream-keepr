<script setup lang="ts">
const eventStore = useEventStore();

const event = computed(() => eventStore.event!);
const loading = computed(() => eventStore.loading);
</script>

<template>
	<div class="flex flex-col gap-6">
		<h2 class="text-xl font-semibold">
			Slots
		</h2>
		<EventConfigFeatureMatchSlots :event="event" :loading="loading" />

		<h2 class="text-xl font-semibold">
			Fields & Tracking
		</h2>
		<EventConfigFieldsAndTracking :event="event" :loading="loading" />
	</div>
</template>
