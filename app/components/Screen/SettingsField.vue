<script setup lang="ts">
/**
 * The one field row of a settings surface: a label and optional description
 * beside their control, stacked on a narrow screen. Every declared field renders
 * through `ScreenConfigField`, which uses it; a bespoke control (an Event
 * Reference picker, a nine-point picker) uses it directly.
 *
 * `stacked` puts the label above a control that takes the row's width, for a
 * narrow panel or a control wider than a row's end. `align` centres a control
 * as short as its label, a switch. Every other attribute (`error`, `data-*`)
 * lands on the form field.
 */
withDefaults(defineProps<{
	label: string;
	description?: string;
	stacked?: boolean;
	align?: 'start' | 'center';
}>(), { align: 'start' });
</script>

<template>
	<UFormField
		:label="label"
		:description="description"
		:class="stacked
			? undefined
			: ['flex max-sm:flex-col justify-between gap-4', align === 'center' ? 'items-center' : 'items-start']"
	>
		<slot />
	</UFormField>
</template>
