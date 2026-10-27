<script setup lang="ts">
const eventStore = useEventStore();

const event = computed(() => eventStore.event!);
const loading = computed(() => eventStore.loading);
</script>

<template>
	<div class="flex flex-col gap-6">
		<h2 class="text-xl font-semibold">
			Details
		</h2>
		<EventConfigEventSettings :event="event" :loading="loading" />

		<h2 class="text-xl font-semibold">
			Match Format
		</h2>
		<EventConfigFormatSettings :event="event" :loading="loading" />
	</div>
</template>
