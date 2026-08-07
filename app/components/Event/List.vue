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

/**
 * What a failed load says to whoever opened the events page.
 *
 * The `error` prop is the object the page caught, and the Event store's loads re-raise the
 * original on purpose — reporting the sentence to `eventStore.error` and narrowing what
 * they hand on are different jobs, and the store only does the first (#262). So the failure
 * arriving here is a `$fetch` one, whose own `message` is the transport's line: rendering
 * it showed '[GET] "/api/events": 403 Forbidden' where the server had written the reason
 * (#271). `failureSentence` owns which failures may be quoted; a 5xx has had its prose
 * replaced with a placeholder on the way out and is left to say what it says as a status
 * line, which reads as machinery rather than as the authority's words (#245).
 */
const failureMessage = computed(() => {
	if (!props.error)
		return null;
	return failureSentence(props.error) ?? props.error.message;
});
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
					{{ failureMessage }}
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
