<script setup lang="ts">
import type { Screen } from '~/types';

// Theme Tokens under a subheading, each writing its own Screen Theme Override:
// a Screen Settings Group's Look, Background & Placement's host tokens, or the
// Screen-wide look's Foundation Tokens. Nothing renders for no tokens.

const props = withDefaults(defineProps<{
	screen: Screen;
	eventId: number;
	heading: string;
	names: readonly string[];
	/** One row per token, as a group's Look shows it; the Screen-wide look shows each in full. */
	compact?: boolean;
}>(), {
	compact: true,
});

const overrides = useScreenThemeOverrides(() => props.screen, () => props.eventId);
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
