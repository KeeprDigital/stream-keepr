<script setup lang="ts">
import { LazyEventCreateModal } from '#components';

definePageMeta({
	title: 'Events',
	layout: false,
});

const eventStore = useEventStore();
const overlay = useOverlay();

const modal = overlay.create(LazyEventCreateModal);

const listLoading = ref(false);
const listError = ref<Error | null>(null);
const hasEvents = computed(() => eventStore.eventsList.length > 0);
const pageState = computed(() => {
	if (listLoading.value)
		return 'loading';
	// EventList renders its own error UI; treat as 'ready' so content
	// (and the page actions) still render instead of getting stuck.
	if (listError.value)
		return 'ready';
	return hasEvents.value ? 'ready' : 'empty';
});

onMounted(async () => {
	await loadList();
});

async function loadList() {
	listLoading.value = true;
	listError.value = null;
	try {
		await eventStore.loadEventsList();
	}
	catch (e) {
		listError.value = e as Error;
	}
	finally {
		listLoading.value = false;
	}
}

function createEvent() {
	void modal.open();
}
</script>

<template>
	<UICollectionPage
		:state="pageState"
		empty-icon="i-lucide-calendar-x"
		empty-title="No events yet"
		empty-description="Create your first event to start managing overlays and screens."
	>
		<template #actions>
			<UButton
				icon="i-lucide-plus"
				@click="createEvent"
			>
				Create Event
			</UButton>
		</template>

		<EventList
			:events="eventStore.eventsList"
			:loading="listLoading"
			:error="listError"
			@load-events-list="loadList"
		/>

		<template #empty-actions>
			<UButton color="primary" icon="i-lucide-plus" @click="createEvent">
				Create Event
			</UButton>
		</template>
	</UICollectionPage>
</template>
