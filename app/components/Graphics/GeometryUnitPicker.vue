<script setup lang="ts">
import type { GeometryUnit } from '~~/shared/types/graphics';

/**
 * The one Geometry Unit choice, as segmented `px | % | ±16` buttons, for every
 * control that shows geometry or motion distance in the author's unit. The host
 * binds it to `useGeometryUnit`, so a choice made in one is the next one's default.
 *
 * Never disabled: the unit is a per-browser view preference, not a write, so a
 * reader without the authoring lease may still switch it.
 */
const unit = defineModel<GeometryUnit>({ required: true });

const UNIT_OPTIONS = [
	{ label: 'px', value: 'px', title: 'Pixels' },
	{ label: '%', value: 'percent', title: 'Percent of the container' },
	{ label: '±16', value: 'grid', title: 'Centred 32-unit grid' },
] as const satisfies ReadonlyArray<{ label: string; value: GeometryUnit; title: string }>;
</script>

<template>
	<UFieldGroup size="xs">
		<UButton
			v-for="option in UNIT_OPTIONS"
			:key="option.value"
			:label="option.label"
			:title="option.title"
			:aria-pressed="unit === option.value"
			color="neutral"
			:variant="unit === option.value ? 'solid' : 'outline'"
			@click="unit = option.value"
		/>
	</UFieldGroup>
</template>
