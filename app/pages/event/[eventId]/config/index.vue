<script setup lang="ts">
const eventStore = useEventStore();
const { handleSubmit } = useEventConfigSubmit();

const event = computed(() => eventStore.event!);
const loading = computed(() => eventStore.loading);
</script>

<template>
	<div class="flex flex-col gap-6">
		<EventConfigEventSettings :event="event" :loading="loading" @submit="handleSubmit" />

		<h2 class="text-xl font-semibold">
			Match Format
		</h2>
		<EventConfigFormatSettings :event="event" :loading="loading" @submit="handleSubmit" />
	</div>
</template>
