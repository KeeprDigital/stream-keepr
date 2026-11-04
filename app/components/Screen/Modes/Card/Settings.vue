<script setup lang="ts">
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';
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

const hasMatchBinding = computed(() => !!config.value.featureMatchId);

const cardSummary = computed(() => settingsSummary([
	`${config.value.cardWidth} px wide`,
	lookSummary('card', props.screen.themeOverrides, ['card']),
]));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsCard id="card:match-binding" title="Match Binding" :collapsible="false">
			<ScreenSettingsField
				label="Linked Match"
				description="Optionally link a match, whose Deck Lists then load on the card search page."
			>
				<ScreenFeatureMatchSelect
					:model-value="config.featureMatchId"
					placeholder="No match linked"
					detailed
					@update:model-value="updateConfig({ featureMatchId: $event })"
				/>
			</ScreenSettingsField>

			<p v-if="!hasMatchBinding" class="text-sm text-muted">
				No match linked. Cards can still be pushed to this screen from the card search page.
			</p>
		</ScreenSettingsCard>

		<ScreenSettingsCard id="card:card" title="Card" :summary="cardSummary">
			<ScreenConfigField
				:field="fields.cardWidth"
				:model-value="config.cardWidth"
				description="The card's width in px."
				@update:model-value="$event !== null && updateConfig({ cardWidth: Number($event) })"
			/>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="card" />
		</ScreenSettingsCard>
	</div>
</template>
