<script setup lang="ts">
import type { ScreenSettingsContext } from '~~/shared/screenModeConfigs/fields';
import type { ModeSettingsExposed } from '~/modules/screen-mode/settingsPage';
import type { Screen } from '~/types';
import { getMetagameRules } from '~~/shared/config/games';
import { fieldDescription, passOnRendererExposed } from '~/modules/screen-mode/settingsPage';

/**
 * The Archetype Spotlight settings page: the generic renderer (#1094), with
 * the top cards' card type chips, and the Event's Conversion Target under its
 * Source where its Metagame reads standings.
 */
defineProps<{
	screen: Screen;
	eventId: number;
}>();

const renderer = useTemplateRef<ModeSettingsExposed>('renderer');

defineExpose(passOnRendererExposed(renderer));

/** The Event's Card Game decides whether its Metagame reads standings, and so a Conversion Rate (ADR-0074). */
function readsStandings({ event }: ScreenSettingsContext): boolean {
	return !event?.game || getMetagameRules(event.game).readsStandings;
}
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<template #card-type-filter="{ fields, config, context, update }">
			<ScreenCardTypeFilterField
				:excluded="config.excludedCardTypes"
				:game="context.event?.game"
				:description="fieldDescription(fields[0]!)"
				test-id-prefix="archetype-spotlight-type"
				@update="update({ excludedCardTypes: $event })"
			/>
		</template>

		<template #after:source="{ context }">
			<ScreenConversionTargetField v-if="readsStandings(context)" :event-id="eventId" />
		</template>
	</ScreenModeSettings>
</template>
