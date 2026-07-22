<script setup lang="ts">
import type { FeatureMatch } from '~/types';

const props = defineProps<{
	matches: FeatureMatch[];
	loading?: boolean;
}>();
</script>

<template>
	<UILoadingSpinner v-if="props.loading" />
	<UIEmptyState
		v-else-if="props.matches.length === 0"
		variant="inline"
		icon="i-lucide-swords"
		title="No matches yet"
		description="Set the number of feature matches in event settings to get started."
	/>
	<div
		v-else
		class="grid grid-cols-1 gap-8"
	>
		<FeatureMatchPanel
			v-for="(match, index) in props.matches"
			:key="match.id"
			:match="match"
			:match-number="index + 1"
			:is-first="index === 0"
			:is-last="index === props.matches.length - 1"
		/>
	</div>
</template>
