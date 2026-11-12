<script setup lang="ts">
import type { MetagameCardTypeBucket } from '~~/shared/utils/metagame';
import type { ModeSettingsExposed } from '~/modules/screen-mode/settingsPage';
import type { Screen } from '~/types';
import { fieldDescription, passOnRendererExposed } from '~/modules/screen-mode/settingsPage';

/**
 * The Most Played Cards settings page: the generic renderer (#1094), with the
 * ranking's card type chips in its Source.
 */
defineProps<{
	screen: Screen;
	eventId: number;
}>();

const renderer = useTemplateRef<ModeSettingsExposed>('renderer');

defineExpose(passOnRendererExposed(renderer));

/** Ranking pointed cards keeps nonbasic lands in, whatever the Land filter holds. */
function lockedTypes(config: Readonly<Record<string, any>>): MetagameCardTypeBucket[] {
	return config.pointedOnly === true
		? ['Land']
		: [];
}
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<!-- Which cards the ranking reads, so it shows page 1 of the new ranking. -->
		<template #card-type-filter="{ fields, config, context, update }">
			<ScreenCardTypeFilterField
				:excluded="config.excludedCardTypes"
				:locked="lockedTypes(config)"
				:game="context.event?.game"
				:description="fieldDescription(fields[0]!)"
				test-id-prefix="top-cards-type"
				@update="update({ excludedCardTypes: $event, currentPage: 1 })"
			/>
		</template>
	</ScreenModeSettings>
</template>
