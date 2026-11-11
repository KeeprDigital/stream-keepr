<script setup lang="ts">
/**
 * A Standings reveal's live controls: reveal the next Player, start over, and
 * how far it has got. Each emits the patch of `revealedCount` it writes.
 */
const props = defineProps<{
	revealedCount: number;
	revealCount: number;
}>();

const emit = defineEmits<{
	update: [patch: { revealedCount: number }];
}>();

const isFullyRevealed = computed(() => props.revealedCount >= props.revealCount);

function revealNext() {
	if (!isFullyRevealed.value)
		emit('update', { revealedCount: props.revealedCount + 1 });
}
</script>

<template>
	<div class="flex items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch">
		<div class="flex items-center gap-2 max-sm:flex-wrap">
			<UButton
				label="Reveal next"
				icon="i-lucide-eye"
				size="sm"
				:disabled="isFullyRevealed"
				@click="revealNext"
			/>
			<UButton
				label="Reset"
				icon="i-lucide-rotate-ccw"
				variant="ghost"
				color="error"
				size="sm"
				:disabled="revealedCount === 0"
				@click="emit('update', { revealedCount: 0 })"
			/>
		</div>
		<UBadge variant="subtle" :color="isFullyRevealed ? 'success' : 'neutral'" data-testid="reveal-progress">
			{{ revealedCount }} of {{ revealCount }} revealed
		</UBadge>
	</div>
</template>
