<script setup lang="ts">
import { useConsumedEventData } from '~/modules/event-data/resync';

/**
 * The Feature Match Slot picker of Screen settings, an Event Reference
 * (ADR-0038): each Slot as `useFeatureMatchMenuItems` names it, its players in
 * the order its followed Session seats them. `detailed` adds each side's deck
 * name and colours under its label. It loads the Event's Slots, re-reads them
 * on Reconnect Resync (#610), and emits the Slot's id, or `null` for none.
 */
const props = withDefaults(defineProps<{
	modelValue?: number | null;
	eventId: number;
	label?: string;
	description?: string;
	nullLabel?: string;
	detailed?: boolean;
	stacked?: boolean;
}>(), {
	label: 'Feature Match Slot',
	nullLabel: 'Select a slot…',
});

const emit = defineEmits<{
	'update:modelValue': [slotId: number | null];
}>();

const featureMatchStore = useFeatureMatchStore();
const items = useFeatureMatchMenuItems();

useConsumedEventData(['featureMatchSlots']);

onMounted(async () => {
	if (props.eventId)
		await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
});
</script>

<template>
	<ScreenEventReferenceField
		:label="label"
		:description="description"
		:null-label="nullLabel"
		:model-value="modelValue"
		:items="items"
		:wide="detailed"
		:stacked="stacked"
		@update:model-value="emit('update:modelValue', $event)"
	>
		<template v-if="detailed" #item-label="{ item }">
			<div class="flex flex-col gap-0.5">
				<span class="font-medium">{{ item.label }}</span>
				<div v-if="item.player1DeckName || item.player2DeckName" class="flex items-center gap-1 text-xs text-muted">
					<template v-if="item.player1DeckName">
						<MtgManaColorDisplay v-if="item.player1Colors" :colors="item.player1Colors" size="xs" />
						<span>{{ item.player1DeckName }}</span>
					</template>
					<template v-if="item.player1DeckName && item.player2DeckName">
						<span class="text-dimmed">vs</span>
					</template>
					<template v-if="item.player2DeckName">
						<MtgManaColorDisplay v-if="item.player2Colors" :colors="item.player2Colors" size="xs" />
						<span>{{ item.player2DeckName }}</span>
					</template>
				</div>
			</div>
		</template>
	</ScreenEventReferenceField>
</template>
