<script setup lang="ts">
import type { Screen } from '~/types';
import { placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';

// A Screen settings group's Look (ADR-0071): the Mode Tokens declaring
// `group` as their `settingsGroup`, under a "Look" subheading after the
// group's config controls. While mounted it registers `group` with the page,
// so the residual Screen-wide look leaves those tokens out.

const props = defineProps<{
	screen: Screen;
	eventId: number;
	group: string;
}>();

const release = useScreenSettingsGroups()?.register(props.group);
onScopeDispose(() => release?.());

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
