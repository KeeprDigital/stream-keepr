<script setup lang="ts">
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import { SCREEN_MODES, THEME_PREVIEW_SCREEN_MODES } from '~~/shared/screenModes';

defineProps<{
	/** The Theme previewed, as stored. */
	tokens: StoredThemeTokens;
}>();
</script>

<template>
	<!-- Every Screen Mode a Theme preview shows, read off its definition: a newly themed mode appears with no change here. -->
	<div class="grid gap-4 sm:grid-cols-2">
		<ThemePreviewTile
			v-for="mode in THEME_PREVIEW_SCREEN_MODES"
			:key="mode"
			:mode="mode"
			:label="SCREEN_MODES[mode].label"
			:tokens="tokens"
		/>
	</div>
</template>
