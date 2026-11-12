<script setup lang="ts">
import type { ScreenSettingsContext } from '~~/shared/screenModeConfigs/fields';
import type { ModeSettingsExposed } from '~/modules/screen-mode/settingsPage';
import type { Screen } from '~/types';
import { isColumnVisible } from '~~/shared/screenModeConfigs/subShapes';
import { isMetagameSortOffered } from '~~/shared/utils/metagame';
import { passOnRendererExposed } from '~/modules/screen-mode/settingsPage';

/**
 * The Metagame settings page: the generic renderer (#1094), with the Event's
 * Conversion Target and, for a chart, where an Archetype pins its series,
 * under the archetype settings. Neither is the Screen's to set.
 */
defineProps<{
	screen: Screen;
	eventId: number;
}>();

const renderer = useTemplateRef<ModeSettingsExposed>('renderer');

defineExpose(passOnRendererExposed(renderer));

/** The Conversion Target matters while the Conversion Rate orders or shows the archetypes, on a Metagame that reads it. */
function showsConversionRate({ config, event }: ScreenSettingsContext): boolean {
	return isMetagameSortOffered(event?.game, 'conversionRate')
		&& (config.sortBy === 'conversionRate' || isColumnVisible(config.archetypeColumns ?? [], 'conversionRate'));
}
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<template #after:archetypes="{ config, context }">
			<ScreenConversionTargetField v-if="showsConversionRate(context)" :event-id="eventId" />

			<ScreenSettingsField
				v-if="config.viewMode === 'chart'"
				label="Pinned chart series"
				description="Give an Archetype its own chart series on the Metagame page, so it keeps that series whichever others show."
			>
				<NuxtLink
					:to="`/event/${eventId}/metagame`"
					data-testid="pinned-chart-series-link"
					class="text-sm text-primary hover:underline"
				>
					Pin on the Metagame page
				</NuxtLink>
			</ScreenSettingsField>
		</template>
	</ScreenModeSettings>
</template>
