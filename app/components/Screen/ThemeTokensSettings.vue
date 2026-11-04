<script setup lang="ts">
import type { Screen } from '~/types';
import { placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';

// A Screen's residual "Screen-wide look" card (ADR-0071): its Foundation
// Tokens (and, on a graphics host, every Foundation Token its Graphic Items
// may bind), then each Mode Token whose settings group no mounted
// `ScreenThemeTokenGroup` renders, so a token renders here until its group is
// mounted and never disappears or doubles. The host's own `inset` and
// `alignment` sit in Background & Placement instead. It starts closed unless
// it holds an override, and remembers per browser once toggled.

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const mountedGroups = useScreenSettingsGroups()?.mounted;
const overrides = useScreenThemeOverrides(() => props.screen, () => props.eventId);

const placement = computed(() => placeScreenThemeTokens(props.screen.currentMode, mountedGroups?.value ?? []).screenWide);
const sections = computed(() => [
	{ label: 'This mode', names: placement.value.modeTokens },
	{ label: 'Foundation', names: placement.value.foundationTokens },
].filter(section => section.names.length > 0));

const overridden = computed(() => sections.value.some(section => section.names.some(name => props.screen.themeOverrides?.[name] !== undefined)));

const subtitle = computed(() => overrides.themeName.value
	? `Inherits from ${overrides.themeName.value}. An override applies to this Screen only.`
	: 'Inherits from the Default Theme. An override applies to this Screen only.');
</script>

<template>
	<ScreenSettingsCard
		v-if="sections.length"
		:id="`${screen.currentMode}:screen-wide-look`"
		title="Screen-wide look"
		:subtitle="subtitle"
		:default-open="overridden"
		data-testid="screen-theme-tokens"
	>
		<UAlert
			v-if="overrides.themeError.value"
			color="warning"
			variant="soft"
			icon="i-lucide-triangle-alert"
			title="The Event's Theme could not be loaded"
			description="Inherited values are shown as the Default Theme ships them."
		/>
		<ScreenThemeTokenRows
			v-for="section in sections"
			:key="section.label"
			:screen="screen"
			:event-id="eventId"
			:heading="section.label"
			:names="section.names"
			:compact="false"
		/>
	</ScreenSettingsCard>
</template>
