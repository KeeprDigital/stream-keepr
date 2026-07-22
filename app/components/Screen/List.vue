<script lang="ts" setup>
import type { Screen, ScreenCommand, ScreenMode } from '~/types';

const props = defineProps<{
	loading: boolean;
	error: string | null;
	screens: Screen[];
	eventId: number;
	updatingScreenId: number | null;
	connectedCounts: Map<number, number>;
}>();

const emit = defineEmits<{
	editScreen: [screen: Screen];
	deleteScreen: [screen: Screen];
	setMode: [screen: Screen, mode: ScreenMode];
	sendCommand: [screen: Screen, command: ScreenCommand];
}>();

function getConnectedCount(screenId: number): number {
	return props.connectedCounts.get(screenId) ?? 0;
}
</script>

<template>
	<!-- Loading State -->
	<UILoadingSpinner v-if="props.loading" />

	<!-- Error State -->
	<div v-else-if="props.error" class="text-center py-12">
		<UCard variant="subtle" class="max-w-xl mx-auto">
			<div class="flex flex-col items-center gap-3 py-6">
				<UIcon name="i-lucide-alert-circle" class="h-12 w-12 text-error" />
				<h3 class="text-lg font-semibold">
					Unable to load screens
				</h3>
				<p class="text-sm text-muted text-center">
					{{ props.error }}
				</p>
			</div>
		</UCard>
	</div>

	<!-- Screens List -->
	<div v-else class="flex flex-col gap-3">
		<ScreenListItem
			v-for="screen in props.screens"
			:key="screen.id"
			:screen="screen"
			:event-id="props.eventId"
			:connected-count="getConnectedCount(screen.id)"
			:is-updating="updatingScreenId === screen.id"
			@edit="emit('editScreen', screen)"
			@delete="emit('deleteScreen', screen)"
			@set-mode="(mode) => emit('setMode', screen, mode)"
			@send-command="(cmd) => emit('sendCommand', screen, cmd)"
		/>
	</div>
</template>
