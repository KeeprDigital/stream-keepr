<script setup lang="ts">
import type { Screen } from '~/types';
import { placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';

// A Screen settings group's Look (ADR-0071): the Mode Tokens declaring
// `group` as their `settingsGroup`, under a "Look" subheading after the
// group's config controls. It registers `group` with the page for as long as
// its card is on it, collapsed or not, so the residual Screen-wide look leaves
// those tokens out.

const props = defineProps<{
	screen: Screen;
	eventId: number;
	group: string;
}>();

useScreenSettingsGroup(props.group);

const names = computed(() => placeScreenThemeTokens(props.screen.currentMode, [props.group]).groups[props.group] ?? []);
</script>

<template>
	<ScreenThemeTokenRows
		:screen="screen"
		:event-id="eventId"
		heading="Look"
		:names="names"
		:data-settings-group="group"
	/>
</template>
