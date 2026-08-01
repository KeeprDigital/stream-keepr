<script setup lang="ts">
/**
 * The first click of a two-click action on one library entry.
 *
 * Placing and deleting both overwrite work an author may not have meant to lose and
 * neither can be undone, so the first click asks and the second one does it. The prompt
 * itself stays with the library, because what an author most needs to know before
 * answering is specific to the artifact — that placed copies survive a deletion, or
 * exactly what a replacement keeps.
 *
 * ## Two callers, by design
 *
 * The Graphic Style Set library's own delete prompt is not this shape, which was
 * examined and settled rather than left to drift (#156). Deleting a referenced Style
 * Set entry is not a yes/no: it "offers one atomic operation to replace its references
 * with another entry of the same kind or detach them", so its prompt carries two
 * destructive answers and a picker to choose the replacement between them. This shape
 * is one destructive answer plus cancel; widening it to fit would leave it contributing
 * a bordered box and a Cancel button.
 */
defineProps<{
	/** Whether this is a destructive removal or a destructive replacement. */
	tone: 'error' | 'warning';
	/** This library's prefix for this action's test ids. */
	testId: string;
	confirmLabel: string;
	/** Whether a write is already in flight against this entry. */
	busy?: boolean;
}>();

const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
	<div
		class="mt-2 rounded-md border p-2"
		:class="tone === 'error' ? 'border-error/40 bg-error/10' : 'border-warning/40 bg-warning/10'"
		:data-testid="`${testId}-confirm`"
	>
		<p class="text-xs">
			<slot />
		</p>
		<div class="mt-2 flex gap-1.5">
			<UButton
				size="xs"
				:color="tone"
				variant="subtle"
				:disabled="busy"
				:data-testid="`${testId}-confirmed`"
				@click="emit('confirm')"
			>
				{{ confirmLabel }}
			</UButton>
			<UButton
				size="xs"
				color="neutral"
				variant="ghost"
				:data-testid="`${testId}-cancelled`"
				@click="emit('cancel')"
			>
				Cancel
			</UButton>
		</div>
	</div>
</template>
