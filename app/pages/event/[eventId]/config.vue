<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import type { NavigationMenuItem } from '#ui/types';
import { LazyUIConfirmDeleteModal, LazyUIUnsavedChangesModal } from '#components';

definePageMeta({
	title: 'Event Settings',
	layout: false,
});

const route = useRoute();
const eventStore = useEventStore();
const overlay = useOverlay();
const { runRequest } = useRequestFeedback();

const { isDirty } = useUnsavedChanges();

const event = computed(() => eventStore.event);
const loading = computed(() => eventStore.loading);
const error = computed(() => eventStore.error);
const routeEventId = computed(() => Number.parseInt(route.params.eventId as string));
const eventId = computed(() => event.value?.id ?? (Number.isNaN(routeEventId.value) ? 0 : routeEventId.value));

// Tab bar
const tabs = computed<NavigationMenuItem[]>(() => [
	{ label: 'Event', icon: 'i-lucide-settings', to: `/event/${eventId.value}/config`, exact: true },
	{ label: 'Features', icon: 'i-lucide-toggle-left', to: `/event/${eventId.value}/config/features` },
	{ label: 'Broadcast', icon: 'i-lucide-radio', to: `/event/${eventId.value}/config/broadcast` },
	{ label: 'Integrations', icon: 'i-lucide-plug', to: `/event/${eventId.value}/config/integrations` },
]);

// Inter-tab dirty state check
const unsavedModal = overlay.create(LazyUIUnsavedChangesModal);

onBeforeRouteUpdate(async () => {
	if (!isDirty.value)
		return true;

	const confirmed = await unsavedModal.open({}).result;
	return confirmed === true;
});

// Delete event
const deleteModal = overlay.create(LazyUIConfirmDeleteModal);

const dropdownItems: DropdownMenuItem[][] = [
	[
		{
			label: 'Delete Event',
			icon: 'i-lucide-trash-2',
			color: 'error' as const,
			onSelect: () => {
				void confirmDeleteEvent();
			},
		},
	],
];

async function handleDelete() {
	if (!event.value)
		return;

	await runRequest(
		() => eventStore.deleteEvent(event.value!.id),
		{
			success: {
				title: 'Success',
				description: 'Event deleted successfully',
				color: 'success',
			},
			error: {
				title: 'Error',
				description: 'Failed to delete event',
				color: 'error',
			},
			onSuccess: () => {
				void navigateTo('/');
			},
			onFailure: ({ error }) => {
				console.error('Failed to delete event:', error);
			},
		},
	);
}

async function confirmDeleteEvent() {
	if (!event.value)
		return;

	const instance = deleteModal.open({
		title: 'Delete Event',
		itemName: event.value.name,
	});

	const confirmed = await instance.result;
	if (confirmed) {
		await handleDelete();
	}
}

async function handleLoadEvent() {
	await eventStore.loadEvent(eventId.value);
}
</script>

<template>
	<NuxtLayout name="default">
		<template #actions>
			<UDropdownMenu
				:items="dropdownItems"
				:content="{ align: 'end' }"
			>
				<UButton
					icon="i-lucide-ellipsis-vertical"
					color="neutral"
					variant="ghost"
					aria-label="Event settings actions"
				/>
			</UDropdownMenu>
		</template>

		<template v-if="event" #toolbar>
			<UNavigationMenu
				highlight
				:items="tabs"
				class="border-b border-default px-4 sm:px-6"
			/>
		</template>

		<UContainer>
			<UILoadingSpinner v-if="loading" size="sm" />

			<div v-else-if="event">
				<NuxtPage />
			</div>

			<UIEmptyState
				v-else-if="error"
				icon="i-lucide-alert-circle"
				title="Error loading event"
				:description="String(error)"
			>
				<template #actions>
					<UButton variant="outline" @click="handleLoadEvent">
						Try Again
					</UButton>
				</template>
			</UIEmptyState>

			<UIEmptyState
				v-else
				variant="inline"
				icon="i-lucide-search-x"
				title="Event not found"
			/>
		</UContainer>
	</NuxtLayout>
</template>
