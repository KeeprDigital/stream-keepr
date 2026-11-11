<script setup lang="ts">
import type { Screen } from '~/types';
import { screenModeConfigContract } from '~~/shared/screenModes';
import { lookSummary, settingsSummary } from '~/composables/screen/screenSettingsSummaries';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'card',
);

defineExpose({ resetConfig, saving });

// Each control's label and bounds, read from the mode's config contract (#498).
const fields = screenModeConfigContract('card').fields;

const hasMatchBinding = computed(() => !!config.value.featureMatchId);

const cardSummary = computed(() => settingsSummary([
	`${config.value.cardWidth} px wide`,
	lookSummary('card', props.screen.themeOverrides, ['card']),
]));
</script>

<template>
	<div class="flex flex-col gap-6">
		<ScreenSettingsSection id="card:feature-match-slot" title="Source" :collapsible="false">
			<ScreenFeatureMatchSlotField
				:model-value="config.featureMatchId"
				:event-id="eventId"
				description="Optionally link a Slot, whose Deck Lists then load on the card search page."
				null-label="No match linked"
				detailed
				@update:model-value="updateConfig({ featureMatchId: $event })"
			/>

			<p v-if="!hasMatchBinding" class="text-sm text-muted">
				No match linked. Cards can still be pushed to this screen from the card search page.
			</p>
		</ScreenSettingsSection>

		<ScreenSettingsSection id="card:card" title="Card" :summary="cardSummary">
			<ScreenConfigField
				:field="fields.cardWidth"
				:model-value="config.cardWidth"
				description="The card's width in px."
				@update:model-value="$event !== null && updateConfig({ cardWidth: Number($event) })"
			/>

			<ScreenThemeTokenGroup :screen="screen" :event-id="eventId" group="card" />
		</ScreenSettingsSection>
	</div>
</template>
