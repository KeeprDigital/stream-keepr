<script setup lang="ts">
import type { ShapeGeometryPresetId } from '~~/shared/modules/graphics';
import type { ShapeCorner, ShapeCornerKey, ShapeCornerTreatment, ShapeGeometry } from '~~/shared/types/graphics';
import { SHAPE_GEOMETRY_PRESETS } from '~~/shared/modules/graphics';
import { MAX_SHAPE_GEOMETRY_PX } from '~~/shared/types/graphics';

/**
 * The one Shape Geometry fields control, for a Graphic Item in the compositor
 * Inspector and for a Theme's Shape Geometry token.
 *
 * Laid out the way the shape is: a starting preset, then the four corners where
 * they sit — each a square, rounded, or cut treatment and, while not square, a
 * size — then the slant of each side edge. Everything is in canvas pixels and
 * bounded by what a saved Shape Geometry accepts. An edit emits a patch: a whole
 * corner, or one slant. "All corners" applies a corner edit to the other three
 * too, which is how most shapes are made.
 *
 * A preset is emitted by id rather than applied here, because what it produces
 * depends on bounds only the host knows — the item's own, a win box's, or none
 * at all for a Theme token — and a preset may also propose a height.
 *
 * `BorderRadiusControl` is not this: a Feature Match Overlay border radius has
 * neither cut corners nor slants.
 */
const props = withDefaults(defineProps<{
	geometry: ShapeGeometry;
	disabled?: boolean;
	size?: 'xs' | 'sm';
}>(), { size: 'sm' });

const emit = defineEmits<{
	update: [patch: Partial<ShapeGeometry>];
	preset: [presetId: ShapeGeometryPresetId];
}>();

const TREATMENTS: { value: ShapeCornerTreatment; label: string; icon: string }[] = [
	{ value: 'square', label: 'Square', icon: 'i-lucide-square' },
	{ value: 'rounded', label: 'Rounded', icon: 'i-lucide-squircle' },
	{ value: 'cut', label: 'Cut', icon: 'i-lucide-octagon' },
];

/** The corners in the order they sit on screen, row by row. */
const CORNERS: { key: ShapeCornerKey; label: string }[] = [
	{ key: 'topLeft', label: 'Top left' },
	{ key: 'topRight', label: 'Top right' },
	{ key: 'bottomLeft', label: 'Bottom left' },
	{ key: 'bottomRight', label: 'Bottom right' },
];

const SLANTS = [
	{
		field: 'leftSlant',
		label: 'Left edge',
		ariaLabel: 'Left edge slant',
		testId: 'shape-left-slant',
	},
	{
		field: 'rightSlant',
		label: 'Right edge',
		ariaLabel: 'Right edge slant',
		testId: 'shape-right-slant',
	},
] as const;

/** Whether a corner edit applies to all four. Editor state only; never stored. */
const allCorners = ref(false);

function updateCorner(corner: ShapeCornerKey, fields: Partial<ShapeCorner>) {
	const next = {
		...props.geometry[corner],
		...fields,
	};
	if (!allCorners.value) {
		emit('update', { [corner]: next });
		return;
	}
	emit('update', Object.fromEntries(CORNERS.map(({ key }) => [
		key,
		{ ...next },
	])) as Partial<ShapeGeometry>);
}
</script>

<template>
	<div class="space-y-3">
		<div>
			<p class="mb-1 text-xs font-medium text-muted">
				Start from
			</p>
			<div class="grid grid-cols-2 gap-1" data-testid="shape-geometry-preset">
				<UButton
					v-for="preset in SHAPE_GEOMETRY_PRESETS"
					:key="preset.id"
					:icon="preset.icon"
					size="xs"
					variant="soft"
					color="neutral"
					class="justify-start"
					:disabled="disabled"
					:data-testid="`shape-geometry-preset-${preset.id}`"
					@click="emit('preset', preset.id)"
				>
					{{ preset.label }}
				</UButton>
			</div>
		</div>

		<div>
			<div class="mb-1 flex items-center justify-between gap-2">
				<p class="text-xs font-medium text-muted">
					Corners
				</p>
				<UButton
					size="xs"
					:variant="allCorners ? 'subtle' : 'ghost'"
					:color="allCorners ? 'primary' : 'neutral'"
					:icon="allCorners ? 'i-lucide-link' : 'i-lucide-unlink'"
					:aria-pressed="allCorners"
					:disabled="disabled"
					data-testid="shape-corners-linked"
					@click="allCorners = !allCorners"
				>
					All corners
				</UButton>
			</div>
			<div class="grid grid-cols-2 gap-2">
				<div
					v-for="corner in CORNERS"
					:key="corner.key"
					class="space-y-1 rounded-md border border-default/60 p-1.5"
				>
					<div class="flex items-center justify-between gap-1">
						<span class="truncate text-[0.6875rem] text-muted">{{ corner.label }}</span>
						<div
							class="flex shrink-0"
							role="group"
							:aria-label="`${corner.label} corner`"
							:data-testid="`shape-corner-${corner.key}`"
							:data-treatment="geometry[corner.key].treatment"
						>
							<UButton
								v-for="treatment in TREATMENTS"
								:key="treatment.value"
								size="xs"
								:icon="treatment.icon"
								:variant="geometry[corner.key].treatment === treatment.value ? 'subtle' : 'ghost'"
								:color="geometry[corner.key].treatment === treatment.value ? 'primary' : 'neutral'"
								:aria-label="`${corner.label} ${treatment.label}`"
								:aria-pressed="geometry[corner.key].treatment === treatment.value"
								:title="treatment.label"
								:disabled="disabled"
								:data-treatment-option="treatment.value"
								@click="updateCorner(corner.key, { treatment: treatment.value })"
							/>
						</div>
					</div>
					<UInputNumber
						v-if="geometry[corner.key].treatment !== 'square'"
						:model-value="geometry[corner.key].size"
						:min="0"
						:max="MAX_SHAPE_GEOMETRY_PX"
						:size="size"
						class="w-full"
						:disabled="disabled"
						:aria-label="`${corner.label} size`"
						@update:model-value="updateCorner(corner.key, { size: $event ?? 0 })"
					/>
				</div>
			</div>
		</div>

		<div>
			<p class="mb-1 text-xs font-medium text-muted">
				Edge slant
			</p>
			<div class="grid grid-cols-2 gap-2">
				<UFormField
					v-for="slant in SLANTS"
					:key="slant.field"
					:label="slant.label"
					:size="size"
				>
					<UInputNumber
						:model-value="geometry[slant.field]"
						:min="-MAX_SHAPE_GEOMETRY_PX"
						:max="MAX_SHAPE_GEOMETRY_PX"
						:size="size"
						class="w-full"
						:disabled="disabled"
						:data-testid="slant.testId"
						:aria-label="slant.ariaLabel"
						@update:model-value="emit('update', { [slant.field]: $event ?? 0 })"
					/>
				</UFormField>
			</div>
		</div>
	</div>
</template>
