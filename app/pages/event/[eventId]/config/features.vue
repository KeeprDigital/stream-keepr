<script setup lang="ts">
const eventStore = useEventStore();

const event = computed(() => eventStore.event!);
const loading = computed(() => eventStore.loading);
</script>

<template>
	<EventConfigFeatureMatchSettings :event="event" :loading="loading" />
</template>
