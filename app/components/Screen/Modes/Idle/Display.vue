<script setup lang="ts">
import type { ScreenMediaBackgroundConfig } from '~~/shared/types/screenConfig';
import { DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG } from '~~/shared/types/screenConfig';

const config = useScreenModeConfig('idle');
const mediaBackground = computed<ScreenMediaBackgroundConfig>(() => ({
	...DEFAULT_SCREEN_MEDIA_BACKGROUND_CONFIG,
	...(config.value.mediaBackground ?? {}),
}));
</script>

<template>
	<div class="idle-state">
		<ScreenMediaBackground :media="mediaBackground" />
	</div>
</template>

<style scoped>
.idle-state {
	position: relative;
	width: 100%;
	height: 100%;
	overflow: hidden;
}
</style>
