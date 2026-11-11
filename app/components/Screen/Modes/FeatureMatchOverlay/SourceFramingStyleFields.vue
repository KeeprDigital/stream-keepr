<script setup lang="ts">
import type { ShapeCornerKey, ShapeGeometry } from '~~/shared/types/graphics';
import type { FeatureMatchOverlayGlowPosition, FeatureMatchSourceFramingStyle } from '~~/shared/types/screenConfig';
import { resolveFeatureMatchOverlayCornerRadii } from '~/utils/featureMatchOverlayGeometry';
import FeatureMatchOverlayBorderSidesControl from './BorderSidesControl.vue';

/**
 * The Source Item framing controls: its shape only. Per-corner radii, which
 * sides of its border show, and which side of the border its glow falls on.
 * Its fill, border and glow are the Theme's `source-surface` Mode Token,
 * shared by every Source Item (#831), whose row follows these fields.
 *
 * The radii are edited in the corner editor a Graphic Item and a Theme share,
 * read as rounded corners of the stored radii; an edit writes each corner's own
 * radius, so what a Source Item stores does not change.
 */

const props = defineProps<{ framingStyle?: FeatureMatchSourceFramingStyle }>();

const emit = defineEmits<{
	update: [updates: Partial<FeatureMatchSourceFramingStyle>];
}>();

const style = computed(() => props.framingStyle ?? {});

const GLOW_POSITION_OPTIONS = [
	{ label: 'Both', value: 'both' },
	{ label: 'Inside', value: 'inside' },
	{ label: 'Outside', value: 'outside' },
] satisfies Array<{ label: string; value: FeatureMatchOverlayGlowPosition }>;

const RADIUS_FIELDS = {
	topLeft: 'borderRadiusTopLeft',
	topRight: 'borderRadiusTopRight',
	bottomRight: 'borderRadiusBottomRight',
	bottomLeft: 'borderRadiusBottomLeft',
} as const satisfies Record<ShapeCornerKey, keyof FeatureMatchSourceFramingStyle>;

/** The stored radii as the corner editor shows a shape: every corner rounded, by its radius. */
const corners = computed<ShapeGeometry>(() => {
	const radii = resolveFeatureMatchOverlayCornerRadii(style.value);
	return {
		topLeft: { treatment: 'rounded', size: radii.topLeft },
		topRight: { treatment: 'rounded', size: radii.topRight },
		bottomRight: { treatment: 'rounded', size: radii.bottomRight },
		bottomLeft: { treatment: 'rounded', size: radii.bottomLeft },
		leftSlant: 0,
		rightSlant: 0,
	};
});

function editCorners(patch: Partial<ShapeGeometry>) {
	const updates: Partial<FeatureMatchSourceFramingStyle> = {};
	for (const corner of Object.keys(RADIUS_FIELDS) as ShapeCornerKey[]) {
		const edited = patch[corner];
		if (edited)
			updates[RADIUS_FIELDS[corner]] = edited.size;
	}
	update(updates);
}

function update(updates: Partial<FeatureMatchSourceFramingStyle>) {
	emit('update', updates);
}
</script>

<template>
	<div class="space-y-3">
		<GraphicsShapeGeometryFields
			:geometry="corners"
			radii
			@update="editCorners"
		/>

		<FeatureMatchOverlayBorderSidesControl
			label="Border sides"
			:sides="style"
			@update="update"
		/>

		<UFormField label="Glow position" size="sm">
			<USelect
				:model-value="style.glowPosition ?? 'both'"
				:items="GLOW_POSITION_OPTIONS"
				value-key="value"
				size="sm"
				class="w-full"
				aria-label="Glow position"
				@update:model-value="update({ glowPosition: $event as FeatureMatchOverlayGlowPosition })"
			/>
		</UFormField>
	</div>
</template>
