<script setup lang="ts">
import type { PageRotationControls } from '~/modules/screen-mode/rotationWrites';

/**
 * A Page Rotation's manual page selection: the previous and next page, and
 * which page of how many shows. Every write goes through the rotation's own
 * writes (ADR-0039).
 */
const props = defineProps<{
	rotation: PageRotationControls;
	/** The rows are loading, so selection waits for them. */
	loading?: boolean;
	/**
	 * The rows have yet to answer their first read (the mode data's `answered`),
	 * so there is no page count: it shows it is counting rather than a
	 * "Page 1 of 1" that would read as an answer (#914).
	 */
	counting?: boolean;
}>();

const currentPage = computed(() => props.rotation.currentPage.value);
const totalPages = computed(() => props.rotation.totalPages.value);
const selectionDisabled = computed(() => totalPages.value <= 1 || props.loading || props.counting);
</script>

<template>
	<div
		role="group"
		aria-label="Page selection"
		:aria-busy="counting"
		class="flex items-center justify-center gap-2 max-sm:flex-wrap"
	>
		<UButton
			label="Previous"
			icon="i-lucide-chevron-left"
			variant="outline"
			:disabled="selectionDisabled"
			@click="rotation.adminPrevPage()"
		/>
		<span class="text-sm text-muted min-w-24 text-center">
			<template v-if="counting">Counting pages…</template>
			<template v-else>Page {{ currentPage }} of {{ totalPages }}</template>
		</span>
		<UButton
			label="Next"
			trailing-icon="i-lucide-chevron-right"
			variant="outline"
			:disabled="selectionDisabled"
			@click="rotation.adminNextPage()"
		/>
	</div>
</template>
