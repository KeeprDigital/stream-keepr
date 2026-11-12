<script setup lang="ts">
import type { Screen } from '~/types';
import { placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';

// A Screen settings group's Look (ADR-0072): the Mode Tokens declaring
// `group` as their `settingsGroup`, under a "Look" subheading after the
// group's config controls, or `heading` where one card holds several Looks.

const props = withDefaults(defineProps<{
	screen: Screen;
	eventId: number;
	group: string;
	heading?: string;
}>(), { heading: 'Look' });

const names = computed(() => placeScreenThemeTokens(props.screen.currentMode).groups[props.group] ?? []);
</script>

<template>
	<ScreenThemeTokenRows
		:event-id="eventId"
		:heading="heading"
		:names="names"
		:data-settings-group="group"
	/>
</template>
