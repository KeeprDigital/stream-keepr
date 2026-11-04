<script setup lang="ts">
/**
 * The Feature Match Slot picker of Screen settings, an Event Reference
 * (ADR-0038): each Slot as `useFeatureMatchMenuItems` names it, its players in
 * the order its followed Session seats them. `detailed` adds each side's deck
 * name and colours under its label. It emits the Slot's id, or `null` when
 * cleared. The editor loads the Slots and wraps it in its field.
 */
withDefaults(defineProps<{
	modelValue?: number | null;
	placeholder: string;
	detailed?: boolean;
}>(), {
	modelValue: undefined,
	detailed: false,
});

const emit = defineEmits<{
	'update:modelValue': [slotId: number | null];
}>();

const items = useFeatureMatchMenuItems();
</script>

<template>
	<USelect
		:model-value="modelValue ?? undefined"
		:items="items"
		value-key="value"
		:placeholder="placeholder"
		:class="detailed ? 'w-72' : 'w-64'"
		:ui="detailed ? { content: 'min-w-fit' } : undefined"
		@update:model-value="emit('update:modelValue', ($event as number | undefined) ?? null)"
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
	</USelect>
</template>
