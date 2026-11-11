<script setup lang="ts">
import type { BackgroundLayersCapableMode } from '~~/shared/screenModes';
import type { BackgroundLayer } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';

/**
 * The Background & Placement card a plain overlay mode gets on the Screen
 * configuration page: that mode's own `backgroundLayers` stack, then the
 * Screen inset and alignment its host places it by, as Screen Theme Overrides
 * (ADR-0051, ADR-0072). It starts closed unless it holds a layer or an override.
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
const placementTokens = computed(() => placeScreenThemeTokens(props.screen.currentMode).placement);
const holdsSomething = computed(() => layers.value.length > 0
	|| placementTokens.value.some(name => props.screen.themeOverrides?.[name] !== undefined));

function writeLayers(nextLayers: BackgroundLayer[]) {
	updateConfig({ backgroundLayers: nextLayers });
}
</script>

<template>
	<ScreenSettingsSection
		:id="`${mode}:background-and-placement`"
		title="Background & Placement"
		subtitle="Layers behind this mode's content, and where the content sits in the Event Canvas."
		:default-open="holdsSomething"
	>
		<ScreenBackgroundLayersEditor
			:layers="layers"
			:event-id="eventId"
			@update:layers="writeLayers"
		/>
		<ScreenThemeTokenRows
			:event-id="eventId"
			heading="Placement"
			:names="placementTokens"
		/>
	</ScreenSettingsSection>
</template>
