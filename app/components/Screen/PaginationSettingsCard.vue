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
 * the editor gives `useRotationConfigWrites` — the rows the Screen Output
 * renders, from the mode's own data (#780); the card never estimates it.
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

		<ScreenPaginationRotationControls
			:rotation="rotation"
			:auto-page-description="autoPageDescription"
			:loading="loading"
		/>
	</ScreenSettingsCard>
</template>
