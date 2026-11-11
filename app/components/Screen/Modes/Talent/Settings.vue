<script setup lang="ts">
import type { Screen } from '~/types';

/**
 * The Talent Screen's settings: the generic renderer (#1094), with the Talent
 * lineup, which no plain control edits, in its `talent-lineup` slot.
 */
defineProps<{
	screen: Screen;
	eventId: number;
}>();

const renderer = useTemplateRef<{ resetConfig: () => void; saving: boolean }>('renderer');

defineExpose({
	resetConfig: () => renderer.value?.resetConfig(),
	saving: computed(() => renderer.value?.saving ?? false),
});
</script>

<template>
	<ScreenModeSettings ref="renderer" :screen="screen" :event-id="eventId">
		<template #talent-lineup="{ config, update }">
			<ScreenModesTalentLineup
				:talent-ids="config.talentIds"
				@update="update({ talentIds: $event })"
			/>
		</template>
	</ScreenModeSettings>
</template>
