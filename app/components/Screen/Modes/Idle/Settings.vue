<script setup lang="ts">
import type { ScreenMediaBackgroundConfig } from '~~/shared/types/screenConfig';
import type { Screen } from '~/types';
import { DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { config, saving, updateConfig, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'idle',
);

defineExpose({ resetConfig, saving });

const mediaBackground = computed<ScreenMediaBackgroundConfig>(() => ({
	...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
	...(config.value.mediaBackground ?? {}),
}));

function updateMediaBackground(updates: Partial<ScreenMediaBackgroundConfig>) {
	updateConfig({ mediaBackground: { ...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG, ...mediaBackground.value, ...updates } });
}
</script>

<template>
	<ScreenSettingsCard title="Video Background">
		<ScreenMediaBackgroundFields
			:media="mediaBackground"
			@update="updateMediaBackground"
		/>
	</ScreenSettingsCard>
</template>
