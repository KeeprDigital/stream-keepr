<script setup lang="ts">
import type { BackgroundLayersCapableMode } from '~~/shared/screenModes';
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';

/**
 * The Background Layers card a plain overlay mode gets on the Screen
 * configuration page, editing that mode's own `backgroundLayers` stack.
 *
 * `mode` is captured once at setup — the configuration composable binds to it —
 * so the owner remounts this component (keyed by mode) when the Screen's mode
 * changes, exactly as it does the mode's own settings component.
 */
const props = defineProps<{
	screen: Screen;
	eventId: number;
	mode: BackgroundLayersCapableMode;
}>();

const mode = props.mode;

const { config, saving, updateConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	mode,
);

defineExpose({ saving });

const layers = computed<BackgroundLayer[]>(() => config.value.backgroundLayers ?? []);

function writeLayers(nextLayers: BackgroundLayer[]) {
	updateConfig({ backgroundLayers: nextLayers });
}
</script>

<template>
	<ScreenSettingsCard
		title="Background Layers"
		subtitle="Painted behind this mode's content."
		:default-open="layers.length > 0"
	>
		<ScreenBackgroundLayersEditor
			:layers="layers"
			:event-id="eventId"
			@update:layers="writeLayers"
		/>
	</ScreenSettingsCard>
</template>
