<script setup lang="ts">
import { conversionTargetLabel, eventConversionTarget } from '~~/shared/conversionTarget';

/**
 * The Event's Conversion Target, read-only (ADR-0061). A Screen counts
 * Conversion Rate against its Event's one target, which the Metagame page sets;
 * the field names the target and links there.
 */
const props = defineProps<{
	eventId: number;
}>();

const eventStore = useEventStore();

const label = computed(() => conversionTargetLabel(eventConversionTarget(eventStore.event)));
</script>

<template>
	<ScreenSettingsField
		label="Conversion target"
		description="What a player in the scope must reach to count as converted. It never narrows the scope. It is the Event's, set on the Metagame page."
	>
		<div class="flex flex-col items-end gap-1">
			<span data-testid="event-conversion-target" class="text-sm font-medium">{{ label }}</span>
			<NuxtLink
				:to="`/event/${props.eventId}/metagame`"
				data-testid="event-conversion-target-link"
				class="text-xs text-primary hover:underline"
			>
				Change on the Metagame page
			</NuxtLink>
		</div>
	</ScreenSettingsField>
</template>
