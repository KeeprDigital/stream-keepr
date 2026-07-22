<script setup lang="ts">
import type { Screen, ScreenCommand, ScreenMode } from '~/types';
import { LazyScreenCreateModal, LazyUIConfirmDeleteModal } from '#components';
import { getScreenModeLabel } from '~/modules/screen-mode';

definePageMeta({
	title: 'Screens',
	layout: false,
});

const eventStore = useEventStore();
const screenStore = useScreenStore();
const overlay = useOverlay();
const { runRequest } = useRequestFeedback();

const event = computed(() => eventStore.event);
const screens = computed(() => screenStore.screens);
const error = computed(() => screenStore.error);
const hasScreens = computed(() => screens.value.length > 0);

const deleteScreen = ref<Screen | null>(null);
const isDeleting = ref(false);
const updatingScreenId = ref<number | null>(null);

// Create overlay instances
const createModal = overlay.create(LazyScreenCreateModal);
const deleteModal = overlay.create(LazyUIConfirmDeleteModal);

const {
	eventId,
	initialLoading: loading,
	initialError,
	retry,
} = useEventPageLoading([
	{ isLoaded: () => screenStore.isLoaded, load: id => screenStore.loadScreensByEventId(id) },
]);

const showScreenList = computed(() => hasScreens.value || loading.value || !!error.value || !!initialError.value);

onBeforeUnmount(() => {
	for (const screen of screenStore.screens) {
		screenStore.unsubscribeFromScreenPresence(screen.id);
	}
});

// Keep presence subscriptions in sync even when the store mutates the array in place.
watch(
	() => screens.value.map(screen => screen.id),
	(newIds, oldIds = []) => {
		const previousIds = new Set(oldIds);
		const nextIds = new Set(newIds);

		for (const screenId of newIds) {
			if (!previousIds.has(screenId)) {
				screenStore.subscribeToScreenPresence(screenId);
			}
		}

		for (const screenId of oldIds) {
			if (!nextIds.has(screenId)) {
				screenStore.unsubscribeFromScreenPresence(screenId);
			}
		}
	},
	{ immediate: true },
);

const connectedCounts = computed(() => {
	const map = new Map<number, number>();
	for (const screen of screens.value) {
		map.set(screen.id, screenStore.getConnectedCount(screen.id));
	}
	return map;
});

function handleCreateScreen() {
	void createModal.open({
		eventId: eventId.value,
		editScreen: null,
	});
}

function handleEditScreen(screen: Screen) {
	void createModal.open({
		eventId: eventId.value,
		editScreen: screen,
	});
}

async function handleDeleteScreen(screen: Screen) {
	deleteScreen.value = screen;
	isDeleting.value = false;

	const instance = deleteModal.open({
		title: 'Delete Screen',
		itemName: screen.name,
		loading: isDeleting.value,
	});

	const confirmed = await instance.result;

	if (confirmed) {
		await confirmDelete();
	}
	else {
		deleteScreen.value = null;
	}
}

async function handleSetMode(screen: Screen, mode: ScreenMode) {
	if (updatingScreenId.value)
		return;
	updatingScreenId.value = screen.id;
	await runRequest(
		() => screenStore.setScreenMode(eventId.value, screen.id, mode),
		{
			success: {
				title: 'Screen Updated',
				description: `Screen mode changed to ${getScreenModeLabel(mode)}`,
				color: 'success',
			},
			error: { title: 'Error', description: 'Failed to update screen mode', color: 'error' },
		},
	);
	updatingScreenId.value = null;
}

async function handleSendCommand(screen: Screen, command: ScreenCommand) {
	const labels: Record<ScreenCommand, string> = {
		refresh: 'Refresh command sent',
		identify: 'Identify command sent',
		debug: 'Debug toggle sent',
	};
	await runRequest(
		async () => {
			await screenStore.sendScreenCommand(screen.id, command);
			return true;
		},
		{
			success: { title: 'Command Sent', description: labels[command], color: 'success' },
			error: { title: 'Command Failed', description: 'Failed to send screen command', color: 'error' },
		},
	);
}

async function confirmDelete() {
	if (!deleteScreen.value || !eventId.value)
		return;

	isDeleting.value = true;
	deleteModal.patch({ loading: true });

	await runRequest(
		() => screenStore.removeScreen(eventId.value!, deleteScreen.value!.id),
		{
			success: {
				title: 'Screen Deleted',
				description: `Screen "${deleteScreen.value.name}" has been deleted`,
				color: 'success',
			},
			error: {
				title: 'Error',
				description: 'Failed to delete screen',
				color: 'error',
			},
			onSuccess: () => {
				deleteScreen.value = null;
			},
			onFailure: ({ error }) => {
				console.error('Failed to delete screen:', error);
			},
		},
	);
	isDeleting.value = false;
	deleteModal.patch({ loading: false });
}
</script>

<template>
	<NuxtLayout name="default">
		<template v-if="hasScreens" #actions>
			<UButton
				icon="i-lucide-plus"
				@click="handleCreateScreen"
			>
				Add Screen
			</UButton>
		</template>

		<UContainer>
			<UIEmptyState
				v-if="!event"
				icon="i-lucide-calendar-x"
				title="Event not found"
				description="This event could not be loaded."
			/>

			<UIInitialLoadError
				v-else-if="initialError"
				:error="initialError"
				@retry="retry"
			/>

			<UIEmptyState
				v-else-if="!showScreenList"
				icon="i-lucide-monitor"
				title="No screens configured"
				description="Create a screen to start showing cards, decks, or match info."
			>
				<template #actions>
					<UButton color="primary" icon="i-lucide-plus" @click="handleCreateScreen">
						Create Screen
					</UButton>
				</template>
			</UIEmptyState>

			<div v-else>
				<ScreenList
					:loading="loading"
					:error="error"
					:screens="screens"
					:event-id="eventId"
					:updating-screen-id="updatingScreenId"
					:connected-counts="connectedCounts"
					@edit-screen="handleEditScreen"
					@delete-screen="handleDeleteScreen"
					@set-mode="handleSetMode"
					@send-command="handleSendCommand"
				/>
			</div>
		</UContainer>
	</NuxtLayout>
</template>
