<script setup lang="ts">
import type { GeometryUnit, GraphicRect } from '~~/shared/types/graphics';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import {
	alignGraphicRect,
	anchoredGraphicPosition,
	displayGeometryValue,
	moveGraphicRectToAnchoredPosition,
	parseGeometryValue,
	resizeGraphicRectFromAnchor,
} from '~~/shared/modules/graphics';
import { useGeometryUnit } from '~/composables/ui/useGeometryUnit';

/**
 * The one geometry fields control, for a Graphic Item in the compositor
 * Inspector and for a Source Item's bounds.
 *
 * It owns display and parsing: values show in the author's Geometry Unit,
 * projected against the containing canvas or Graphic Group, and every edit is
 * emitted as a patch of the stored top-left rectangle in canonical pixels. A
 * position edit moves the anchored coordinate; a size edit resizes around the
 * anchor and never below one pixel; an align action moves the item's edge.
 *
 * An item its row or column Graphic Group positions (`stacked`) offers width and
 * height only: its group's align and justify own where it sits.
 */
const props = defineProps<{
	/** The stored top-left rectangle, in canonical pixels. */
	rect: GraphicRect;
	/** What positions, percentages, and alignment are measured against. */
	container: { width: number; height: number };
	/** A Graphic Anchor Point or a Source Item's anchor: the same nine points. */
	anchor: NinePoint;
	stacked?: boolean;
	/** The anchor picker's label, which each host names in its own vocabulary. */
	anchorLabel?: string;
}>();

const emit = defineEmits<{
	'update:anchor': [anchor: NinePoint];
	'update': [patch: Partial<GraphicRect>];
}>();

const unit = useGeometryUnit();

const UNIT_OPTIONS = [
	{ label: 'px', value: 'px', title: 'Pixels' },
	{ label: '%', value: 'percent', title: 'Percent of the container' },
	{ label: '±16', value: 'grid', title: 'Centred 32-unit grid' },
] as const satisfies ReadonlyArray<{ label: string; value: GeometryUnit; title: string }>;

/** One row of align actions per axis. */
const ALIGN_ACTIONS = [
	{
		axis: 'x',
		actions: [
			{ label: 'Hard left', edge: 'start', icon: 'i-lucide-align-start-vertical' },
			{ label: 'Center horizontally', edge: 'center', icon: 'i-lucide-align-center-vertical' },
			{ label: 'Hard right', edge: 'end', icon: 'i-lucide-align-end-vertical' },
		],
	},
	{
		axis: 'y',
		actions: [
			{ label: 'Hard top', edge: 'start', icon: 'i-lucide-align-start-horizontal' },
			{ label: 'Center vertically', edge: 'center', icon: 'i-lucide-align-center-horizontal' },
			{ label: 'Hard bottom', edge: 'end', icon: 'i-lucide-align-end-horizontal' },
		],
	},
] as const;

const SIZE_AXES = { width: 'x', height: 'y' } as const;

function containerSpan(axis: 'x' | 'y') {
	return axis === 'x' ? props.container.width : props.container.height;
}

const anchoredPosition = computed(() => anchoredGraphicPosition(props.rect, props.anchor));

function shownPosition(axis: 'x' | 'y') {
	return displayGeometryValue(anchoredPosition.value[axis], containerSpan(axis), unit.value, true);
}

function shownSize(axis: 'width' | 'height') {
	return displayGeometryValue(props.rect[axis], containerSpan(SIZE_AXES[axis]), unit.value);
}

function updatePosition(axis: 'x' | 'y', value: number | null | undefined) {
	const pixels = parseGeometryValue(value ?? 0, containerSpan(axis), unit.value, true);
	emit('update', moveGraphicRectToAnchoredPosition(props.rect, axis, pixels, props.anchor));
}

function updateSize(axis: 'width' | 'height', value: number | null | undefined) {
	const pixels = parseGeometryValue(value ?? 0, containerSpan(SIZE_AXES[axis]), unit.value);
	emit('update', resizeGraphicRectFromAnchor(props.rect, { [axis]: Math.max(1, pixels) }, props.anchor));
}

function align(axis: 'x' | 'y', edge: 'start' | 'center' | 'end') {
	emit('update', alignGraphicRect(props.rect, axis, edge, props.container));
}

/** Typed decimals survive in % and the grid; the arrows still step whole units in px and %. */
const step = computed(() => unit.value === 'grid' ? 0.01 : 1);
const stepSnapping = computed(() => unit.value === 'px');
</script>

<template>
	<div class="space-y-3">
		<UFormField label="Units" size="sm">
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
		</UFormField>

		<div v-if="!stacked" class="flex flex-wrap gap-4">
			<UFormField :label="anchorLabel ?? 'Anchor'" size="sm">
				<UINinePointPicker
					:model-value="anchor"
					:aria-label="anchorLabel ?? 'Anchor'"
					@update:model-value="emit('update:anchor', $event)"
				/>
			</UFormField>

			<UFormField label="Align" size="sm">
				<div class="space-y-1">
					<div
						v-for="{ axis, actions } in ALIGN_ACTIONS"
						:key="axis"
						class="grid grid-cols-3 gap-1"
					>
						<UButton
							v-for="action in actions"
							:key="action.edge"
							:aria-label="action.label"
							:title="action.label"
							:icon="action.icon"
							size="xs"
							color="neutral"
							variant="soft"
							class="size-7 justify-center p-0"
							@click="align(axis, action.edge)"
						/>
					</div>
				</div>
			</UFormField>
		</div>

		<div class="grid grid-cols-2 gap-2">
			<template v-if="!stacked">
				<UFormField
					v-for="axis in ['x', 'y'] as const"
					:key="axis"
					:label="axis.toUpperCase()"
					size="sm"
				>
					<UInputNumber
						:model-value="shownPosition(axis)"
						:step="step"
						:step-snapping="stepSnapping"
						size="sm"
						class="w-full"
						:aria-label="`Item ${axis}`"
						@update:model-value="updatePosition(axis, $event)"
					/>
				</UFormField>
			</template>
			<UFormField
				v-for="axis in ['width', 'height'] as const"
				:key="axis"
				:label="axis === 'width' ? 'Width' : 'Height'"
				size="sm"
			>
				<UInputNumber
					:model-value="shownSize(axis)"
					:step="step"
					:step-snapping="stepSnapping"
					size="sm"
					class="w-full"
					:aria-label="`Item ${axis}`"
					@update:model-value="updateSize(axis, $event)"
				/>
			</UFormField>
		</div>
	</div>
</template>
