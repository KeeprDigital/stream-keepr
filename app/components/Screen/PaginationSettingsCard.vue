<script setup lang="ts">
import type { PageRotationControls } from '~/modules/screen-mode/rotationWrites';

/**
 * The Pagination card every paginated Screen Mode's settings render: rows per
 * page, auto-page and its interval, and manual page selection. It is driven by
 * the mode's Page Rotation declaration (ADR-0039), so it edits whichever page
 * size field the mode names, and writes only through the rotation's own writes,
 * which restart the rotation from page 1 on a shape change (ADR-0009).
 *
 * The page count is the rotation's `totalPages`, counted from the row count
 * the editor gives `useRotationConfigWrites`; the card never estimates it.
 */
const props = defineProps<{
	/** The mode's Page Rotation, from its editor's `useRotationConfigWrites`. */
	rotation: PageRotationControls;
	/** What a page holds, in the mode's own words. */
	pageSizeDescription: string;
	/** What auto-page cycles through, in the mode's own words. */
	autoPageDescription: string;
	/** The rows are loading, so manual page selection waits for them. */
	loading?: boolean;
}>();

// Each control's label and bounds, read from the mode's config contract (#498).
const fields = computed(() => props.rotation.fields);
const pageSize = computed(() => props.rotation.pageSize.value);
const autoPageEnabled = computed(() => props.rotation.rotationConfig.value.autoPageEnabled);
const intervalSeconds = computed(() =>
	Math.round(props.rotation.rotationConfig.value.autoPageIntervalMs / fields.value.autoPageIntervalMs.displayScale),
);
const currentPage = computed(() => props.rotation.currentPage.value);
const totalPages = computed(() => props.rotation.totalPages.value);
const pageSelectionDisabled = computed(() => totalPages.value <= 1 || props.loading);
</script>

<template>
	<ScreenSettingsCard title="Pagination">
		<UFormField
			:label="fields.pageSize.label"
			:description="pageSizeDescription"
			class="flex max-sm:flex-col justify-between items-start gap-4"
		>
			<UInputNumber
				:model-value="pageSize"
				:min="fields.pageSize.min"
				:max="fields.pageSize.max"
				class="w-32"
				@update:model-value="rotation.setPageSize(Number($event))"
			/>
		</UFormField>

		<USeparator />

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
	</ScreenSettingsCard>
</template>
