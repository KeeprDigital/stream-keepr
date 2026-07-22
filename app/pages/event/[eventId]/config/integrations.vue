<script setup lang="ts">
const eventStore = useEventStore();
const { handleSubmit } = useEventConfigSubmit();

const event = computed(() => eventStore.event!);
const loading = computed(() => eventStore.loading);
</script>

<template>
	<div class="flex flex-col gap-6">
		<EventConfigMeleeIntegration :event-id="event.id" />

		<h2 class="text-xl font-semibold">
			Public API
		</h2>
		<EventConfigApiSettings :event="event" :loading="loading" @submit="handleSubmit" />
	</div>
</template>
