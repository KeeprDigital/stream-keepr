<script setup lang="ts">
import type { StoredThemeTokens } from '~~/shared/modules/theme';
import { THEMED_SCREEN_MODE_TOKENS } from '~~/shared/themeTokens';

defineProps<{
	/** The Theme previewed, as stored. */
	tokens: StoredThemeTokens;
}>();
</script>

<template>
	<!-- Every Screen Mode declaring Mode Tokens, read off its definition: a newly themed mode appears with no change here. -->
	<div class="grid gap-4 sm:grid-cols-2">
		<ThemePreviewTile
			v-for="group in THEMED_SCREEN_MODE_TOKENS"
			:key="group.mode"
			:mode="group.mode"
			:label="group.label"
			:tokens="tokens"
		/>
	</div>
</template>
