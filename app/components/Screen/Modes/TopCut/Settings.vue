<script setup lang="ts">
import type { ModeSettingsExposed } from '~/modules/screen-mode/settingsPage';
import type { Screen } from '~/types';
import { useConsumedEventData } from '~/modules/event-data/resync';
import { passOnRendererExposed } from '~/modules/screen-mode/settingsPage';

/**
 * The Top Cut Bracket Screen's settings: the generic renderer (#1094), with
 * the two controls no plain control is in their slots: the Manual Bracket
 * editor (`manual-bracket`, in the Live card, since its results are marked
 * during the show) and the bracket size (`bracket-size`).
 */
const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const renderer = useTemplateRef<ModeSettingsExposed>('renderer');

defineExpose(passOnRendererExposed(renderer));

const playerStore = usePlayerStore();

// The Players a Manual Bracket's Seeds pick from, re-read on Reconnect Resync (#610).
useConsumedEventData(['players']);

onMounted(async () => {
	if (props.eventId && !playerStore.isLoaded)
		await playerStore.loadPlayersByEventId(props.eventId);
});
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<template #manual-bracket="{ config, update }">
			<ScreenModesTopCutManualBracketEditor
				:manual="config.manualBracket"
				@update="update({ manualBracket: $event })"
			/>
		</template>

		<template #bracket-size="{ config, fields, update }">
			<ScreenModesTopCutBracketSizeField
				:entry="fields[0]!"
				:model-value="config.bracketSizeOverride"
				@update:model-value="update({ bracketSizeOverride: $event })"
			/>
		</template>
	</ScreenModeSettings>
</template>
