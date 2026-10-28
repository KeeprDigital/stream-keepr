<script setup lang="ts">
import type { PageRotationControls } from '~/modules/screen-mode/rotationWrites';

/**
 * A Page Rotation's auto-page and manual page controls, without its page size:
 * the Pagination card renders them under its page size field, and a mode that
 * edits its page size beside its other settings, as Most Played Cards does,
 * renders them there. Every write goes through the rotation's own writes (ADR-0039).
 */
const props = defineProps<{
	rotation: PageRotationControls;
	/** What auto-page cycles through, in the mode's own words. */
	autoPageDescription: string;
	/** The rows are loading, so manual page selection waits for them. */
	loading?: boolean;
}>();

const fields = computed(() => props.rotation.fields);
const autoPageEnabled = computed(() => props.rotation.rotationConfig.value.autoPageEnabled);
const intervalSeconds = computed(() =>
	Math.round(props.rotation.rotationConfig.value.autoPageIntervalMs / fields.value.autoPageIntervalMs.displayScale),
);
const currentPage = computed(() => props.rotation.currentPage.value);
const totalPages = computed(() => props.rotation.totalPages.value);
const pageSelectionDisabled = computed(() => totalPages.value <= 1 || props.loading);
</script>

<template>
	<p class="text-xs font-semibold uppercase tracking-wider text-muted">
		Automatic Paging
	</p>

	<ScreenSettingsToggle
		:label="fields.autoPageEnabled.label"
		:description="autoPageDescription"
		:model-value="autoPageEnabled"
		@update:model-value="rotation.setAutoPageEnabled($event === true)"
	/>

	<UFormField
		v-if="autoPageEnabled"
		:label="fields.autoPageIntervalMs.label"
		description="Time between page transitions."
		class="flex max-sm:flex-col justify-between items-start gap-4"
	>
		<UInputNumber
			:model-value="intervalSeconds"
			:min="fields.autoPageIntervalMs.min"
			:max="fields.autoPageIntervalMs.max"
			class="w-32"
			@update:model-value="rotation.setPageDurationMs(Number($event) * fields.autoPageIntervalMs.displayScale)"
		/>
	</UFormField>

	<USeparator />

	<p class="text-xs font-semibold uppercase tracking-wider text-muted">
		Manual Page Controls
	</p>

	<div class="flex items-center justify-center gap-2 max-sm:flex-wrap">
		<UButton
			label="Previous"
			icon="i-lucide-chevron-left"
			variant="outline"
			:disabled="pageSelectionDisabled"
			@click="rotation.adminPrevPage()"
		/>
		<span class="text-sm text-muted min-w-24 text-center">
			Page {{ currentPage }} of {{ totalPages }}
		</span>
		<UButton
			label="Next"
			trailing-icon="i-lucide-chevron-right"
			variant="outline"
			:disabled="pageSelectionDisabled"
			@click="rotation.adminNextPage()"
		/>
	</div>
</template>
