<script setup lang="ts">
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'background',
);

defineExpose({ resetConfig, saving });

const layers = computed<BackgroundLayer[]>(() => config.value.layers ?? []);

function writeLayers(nextLayers: BackgroundLayer[]) {
	updateConfig({ layers: nextLayers });
}
</script>

<template>
	<ScreenSettingsCard title="Background Layers">
		<ScreenBackgroundLayersEditor
			:layers="layers"
			:event-id="eventId"
			@update:layers="writeLayers"
		/>
	</ScreenSettingsCard>
</template>
