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
	/**
	 * The rows have yet to answer their first read (the mode data's `answered`),
	 * so there is no page count: the controls show they are counting rather than
	 * a "Page 1 of 1" that would read as an answer (#914).
	 */
	counting?: boolean;
}>();

const fields = computed(() => props.rotation.fields);
const autoPageEnabled = computed(() => props.rotation.rotationConfig.value.autoPageEnabled);
const intervalMs = computed(() => props.rotation.rotationConfig.value.autoPageIntervalMs);
</script>

<template>
	<ScreenSettingsSubheading>
		Automatic paging
	</ScreenSettingsSubheading>

	<ScreenSettingsToggle
		:label="fields.autoPageEnabled.label"
		:description="autoPageDescription"
		:model-value="autoPageEnabled"
		@update:model-value="rotation.setAutoPageEnabled($event === true)"
	/>

	<ScreenSettingsField
		v-if="autoPageEnabled"
		:label="fields.autoPageIntervalMs.label"
		description="Time between page transitions."
	>
		<ScreenSettingsNumberField
			:model-value="intervalMs"
			:display-scale="fields.autoPageIntervalMs.displayScale"
			:min="fields.autoPageIntervalMs.min"
			:max="fields.autoPageIntervalMs.max"
			@update:model-value="rotation.setPageDurationMs(Number($event))"
		/>
	</ScreenSettingsField>

	<USeparator />

	<ScreenSettingsSubheading>
		Manual Page Controls
	</ScreenSettingsSubheading>

	<ScreenPageSelection :rotation="rotation" :loading="loading" :counting="counting" />
</template>
