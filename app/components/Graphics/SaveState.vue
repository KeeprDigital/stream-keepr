<script setup lang="ts">
/**
 * The answer of an editor's authored save, shown the same way by every graphics
 * host: in flight, committed, or failed in the authority's own words with a
 * Retry.
 *
 * Committed is said, not implied by the absence of "Saving…": a save can run for
 * seconds, and an author who looked away cannot otherwise tell the two apart.
 * A failure shows the server's sentence, because a refusal names the path it
 * refused.
 *
 * Only the Graphics Authoring Lease holder sees it. An observer's editor shows a
 * colleague's accepted changes and has no save of its own in flight; a failure
 * there would prescribe retrying someone else's write.
 */
defineProps<{
	saveState: 'idle' | 'saving' | 'committed' | 'failed';
	/** The sentence the authority wrote about a failed save, when it wrote one. */
	saveError?: string | null;
	/** Whether this Session holds the Graphics Authoring Lease. */
	writable: boolean;
}>();

/** Re-send the failed save's still-held updates. */
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
	<div
		v-if="writable && saveState !== 'idle'"
		class="flex min-w-0 items-center gap-1.5 text-xs"
		:class="saveState === 'failed' ? 'text-error' : 'text-muted'"
		role="status"
		data-testid="graphics-save-state"
		:data-save-state="saveState"
	>
		<template v-if="saveState === 'saving'">
			<UIcon name="i-lucide-loader-circle" class="size-3.5 shrink-0 animate-spin" />
			Saving…
		</template>
		<template v-else-if="saveState === 'committed'">
			<UIcon name="i-lucide-check" class="size-3.5 shrink-0 text-success" />
			Saved
		</template>
		<template v-else>
			<UIcon name="i-lucide-triangle-alert" class="size-3.5 shrink-0" />
			<span class="min-w-0">{{ saveError ?? 'The last save failed.' }}</span>
			<UButton
				size="xs"
				color="error"
				variant="soft"
				icon="i-lucide-rotate-cw"
				class="shrink-0"
				data-testid="graphics-save-retry"
				@click="emit('retry')"
			>
				Retry
			</UButton>
		</template>
	</div>
</template>
