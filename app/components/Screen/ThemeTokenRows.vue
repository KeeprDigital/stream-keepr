<script setup lang="ts">
// Theme Tokens under a subheading, each writing its own Screen Theme Override:
// a Screen Settings Group's Look, Background & Placement's host tokens, or the
// Screen-wide look's Foundation Tokens. Nothing renders for no tokens. The
// rows read and write through the one instance the Screen's page provides.

const props = withDefaults(defineProps<{
	/** The Event whose Graphics Assets an asset row picks from. */
	eventId: number;
	heading: string;
	names: readonly string[];
	/** One row per token, as a group's Look shows it; the Screen-wide look shows each in full. */
	compact?: boolean;
}>(), {
	compact: true,
});

const overrides = useScreenThemeOverrides();
const entries = computed(() => props.names.map(name => overrides.entry(name)));
</script>

<template>
	<div v-if="entries.length">
		<p class="text-xs font-medium uppercase text-muted">
			{{ heading }}
		</p>
		<ThemeTokenField
			v-for="entry in entries"
			:key="entry.name"
			:compact="compact"
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
