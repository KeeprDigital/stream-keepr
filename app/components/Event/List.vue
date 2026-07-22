<script lang="ts" setup>
import type { Event } from '~/types';

const props = defineProps<{
	loading: boolean;
	error: Error | null;
	events: Event[];
}>();

const emit = defineEmits<{
	(e: 'loadEventsList'): void;
}>();
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
					Unable to load events
				</h3>
				<p class="text-sm text-muted text-center">
					{{ props.error.message }}
				</p>
				<UButton @click="emit('loadEventsList')">
					Try Again
				</UButton>
			</div>
		</UCard>
	</div>

	<!-- Events Grid -->
	<div v-else>
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
			<EventListItem
				v-for="event in props.events"
				:key="event.id"
				:event="event"
			/>
		</div>
	</div>
</template>
