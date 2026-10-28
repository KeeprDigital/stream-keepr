<script setup lang="ts">
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { useConsumedEventData } from '~/modules/event-data/resync';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const featureMatchStore = useFeatureMatchStore();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'card',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
const fields = screenModeConfigContract('card').fields;

// What the pickers below load, re-read on Reconnect Resync (#610).
useConsumedEventData(['featureMatchSlots']);

onMounted(async () => {
	if (props.eventId) {
		await featureMatchStore.loadFeatureMatchesByEventId(props.eventId);
	}
});

const matchOptions = useFeatureMatchMenuItems();

const hasMatchBinding = computed(() => !!config.value.featureMatchId);
</script>

<template>
	<div class="flex flex-col gap-6">
		<!-- Match Binding (Optional) -->
		<ScreenSettingsCard title="Match Binding">
			<UFormField
				label="Linked Match"
				description="Optionally link to a match. When selected in the card search page, the linked match's decklists will auto-load."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<USelect
					:model-value="config.featureMatchId ?? undefined"
					:items="matchOptions"
					value-key="value"
					placeholder="No match linked"
					class="w-72"
					:ui="{ content: 'min-w-fit' }"
					@update:model-value="updateConfig({ featureMatchId: ($event ?? null) })"
				>
					<template #item-label="{ item }">
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
			</UFormField>

			<p v-if="!hasMatchBinding" class="text-sm text-muted">
				No match linked. Cards can still be pushed to this screen from the card search page.
			</p>
		</ScreenSettingsCard>

		<ScreenSettingsCard title="Card">
			<UFormField
				:label="fields.cardWidth.label"
				description="The card's width in px."
				class="flex max-sm:flex-col justify-between items-start gap-4"
			>
				<UInputNumber
					:model-value="config.cardWidth"
					:min="fields.cardWidth.min"
					:max="fields.cardWidth.max"
					class="w-32"
					@update:model-value="updateConfig({ cardWidth: Number($event) })"
				/>
			</UFormField>
		</ScreenSettingsCard>
	</div>
</template>
