<script setup lang="ts">
import type { Screen } from '~/types';

const props = defineProps<{
	screen: Screen;
	eventId: number;
}>();

const { saving, resetConfig } = useModeConfigUpdate(
	() => props.eventId,
	() => props.screen.id,
	'topCut',
);

defineExpose({ resetConfig, saving });
</script>

<template>
	<UCard variant="subtle">
		<div class="text-center py-4 text-muted">
			<UIcon name="i-lucide-git-branch" class="text-3xl mb-2" />
			<p>Top cut / bracket configuration coming soon.</p>
		</div>
	</UCard>
</template>
