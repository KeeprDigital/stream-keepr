<script setup lang="ts">
const eventStore = useEventStore();
const featureMatchStore = useFeatureMatchStore();
const featureMatchStateStore = useFeatureMatchStateStore();
const toast = useToast();

const isDisabled = computed(() => !eventStore.eventId || featureMatchStore.featureMatches.length === 0);
const matchCount = computed(() => featureMatchStore.featureMatches.length);

const runningCount = computed(() => {
	let count = 0;
	for (const state of featureMatchStateStore.featureMatchStates.values()) {
		if (state.clock.isRunning)
			count++;
	}
	return count;
});

const pausedCount = computed(() => {
	let count = 0;
	for (const state of featureMatchStateStore.featureMatchStates.values()) {
		if (!state.clock.isRunning && state.clock.elapsedMs > 0)
			count++;
	}
	return count;
});

const statusText = computed(() => {
	if (runningCount.value > 0)
		return `${runningCount.value} of ${matchCount.value} running`;
	if (pausedCount.value > 0)
		return `${pausedCount.value} of ${matchCount.value} paused`;
	return `${matchCount.value} clock${matchCount.value === 1 ? '' : 's'} idle`;
});

const statusColor = computed(() => {
	if (runningCount.value > 0)
		return 'text-primary';
	if (pausedCount.value > 0)
		return 'text-warning';
	return 'text-muted';
});

const decrementOptions = CLOCK_DECREMENT_OPTIONS;
const incrementOptions = CLOCK_INCREMENT_OPTIONS;

function getEventId(): number | null {
	if (!eventStore.eventId) {
		toast.add({
			title: 'Event not loaded',
			color: 'error',
		});
		return null;
	}
	return eventStore.eventId;
}

async function handleStartAll() {
	const eventId = getEventId();
	if (!eventId)
		return;
	await featureMatchStateStore.startAllClocks(eventId);
}

async function handlePauseAll() {
	const eventId = getEventId();
	if (!eventId)
		return;
	await featureMatchStateStore.pauseAllClocks(eventId);
}

async function handleResetAll() {
	const eventId = getEventId();
	if (!eventId)
		return;
	await featureMatchStateStore.resetAllClocks(eventId);
}

async function handleAdjustAll(deltaMs: number) {
	const eventId = getEventId();
	if (!eventId)
		return;
	await featureMatchStateStore.adjustAllClocks(eventId, deltaMs);
}
</script>

<template>
	<UDashboardToolbar>
		<template #left>
			<div class="flex items-center gap-3">
				<UIcon name="i-lucide-timer" class="size-4 text-muted" />
				<span class="text-sm font-medium" :class="statusColor">
					{{ statusText }}
				</span>
			</div>
		</template>

		<template #right>
			<div class="flex items-center gap-3">
				<UButton
					icon="i-lucide-play"
					color="primary"
					variant="soft"
					size="sm"
					:disabled="isDisabled"
					@click="handleStartAll"
				>
					Start All
				</UButton>
				<UButton
					icon="i-lucide-pause"
					color="warning"
					variant="soft"
					size="sm"
					:disabled="isDisabled"
					@click="handlePauseAll"
				>
					Pause All
				</UButton>
				<UButton
					icon="i-lucide-refresh-ccw"
					color="error"
					variant="soft"
					size="sm"
					:disabled="isDisabled"
					@click="handleResetAll"
				>
					Reset All
				</UButton>

				<USeparator orientation="vertical" class="h-4" />

				<UPopover>
					<UButton
						icon="i-lucide-clock"
						variant="ghost"
						color="neutral"
						size="sm"
						trailing-icon="i-lucide-chevron-down"
						:disabled="isDisabled"
					>
						Adjust
					</UButton>

					<template #content>
						<div class="p-3 flex items-center justify-center gap-1">
							<UButton
								v-for="option in decrementOptions"
								:key="option.label"
								color="error"
								variant="soft"
								:disabled="isDisabled"
								@click="handleAdjustAll(option.deltaMs)"
							>
								{{ option.label }}
							</UButton>

							<span class="w-px h-5 bg-default mx-1" />

							<UButton
								v-for="option in incrementOptions"
								:key="option.label"
								color="success"
								variant="soft"
								:disabled="isDisabled"
								@click="handleAdjustAll(option.deltaMs)"
							>
								{{ option.label }}
							</UButton>
						</div>
					</template>
				</UPopover>
			</div>
		</template>
	</UDashboardToolbar>
</template>
