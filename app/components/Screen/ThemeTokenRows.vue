<script setup lang="ts">
// Theme Tokens under a subheading, each writing its own Screen Theme Override:
// a Screen Settings Group's Look, or Background & Placement's host tokens, one
// compact row each. Nothing renders for no tokens. The rows read and write
// through the one instance the Screen's page provides.

const props = defineProps<{
	/** The Event whose Graphics Assets an asset row picks from. */
	eventId: number;
	heading: string;
	names: readonly string[];
}>();

const overrides = useScreenThemeOverrides();
const entries = computed(() => props.names.map(name => overrides.entry(name)));
</script>

<template>
	<div v-if="entries.length">
		<ScreenSettingsSubheading>
			{{ heading }}
		</ScreenSettingsSubheading>
		<ThemeTokenField
			v-for="entry in entries"
			:key="entry.name"
			compact
			scope="screen"
			:name="entry.name"
			:token="entry.token"
			:stored="entry.stored"
			:inherited="entry.inherited"
			:resolved="entry.resolved"
			:event-id="eventId"
			:writing="overrides.writing.value.has(entry.name)"
			@set="value => overrides.set(entry.name, value)"
			@clear="overrides.clear(entry.name)"
		/>
	</div>
</template>
