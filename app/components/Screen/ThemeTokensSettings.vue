<script setup lang="ts">
import type { Screen } from '~/types';
import { placeScreenThemeTokens } from '~~/shared/screenThemeOverrides';

// A Screen's "Screen-wide look" card (ADR-0072): its Foundation Tokens (and,
// on a graphics host, every Foundation Token its Graphic Items may bind). A
// Mode Token sits in its group's Look, and the host's own `inset` and
// `alignment` in Background & Placement. It starts closed unless it holds an
// override, and remembers per browser once toggled.

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const overrides = useScreenThemeOverrides(() => props.screen, () => props.eventId);

const names = computed(() => placeScreenThemeTokens(props.screen.currentMode).foundationTokens);

const overridden = computed(() => names.value.some(name => props.screen.themeOverrides?.[name] !== undefined));

const subtitle = computed(() => overrides.themeName.value
	? `Inherits from ${overrides.themeName.value}. An override applies to this Screen only.`
	: 'Inherits from the Default Theme. An override applies to this Screen only.');
</script>

<template>
	<ScreenSettingsSection
		v-if="names.length"
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
			:screen="screen"
			:event-id="eventId"
			heading="Foundation"
			:names="names"
			:compact="false"
		/>
	</ScreenSettingsSection>
</template>
