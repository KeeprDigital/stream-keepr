<script setup lang="ts">
import type { GraphicRect } from '~~/shared/types/graphics';
import type { NinePoint } from '~~/shared/utils/ninePoints';
import {
	alignGraphicRect,
	anchoredGraphicPosition,
	displayGeometryValue,
	geometryUnitInputStep,
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
 *
 * Linking width and height keeps the ratio captured when the author links them:
 * either size edit then sets the other in pixels, whatever the Geometry Unit.
 * The link is editor state, never stored on the item, and only offered while
 * both sizes are fixed values, which a stacked item's group sizing may not be.
 * A host keys this control by item, so a link never carries over to the next one.
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

/** Width over height, captured when the author links them; null while unlinked. */
const linkedRatio = ref<number | null>(null);
/** The ratio a size edit keeps: none for a stacked item, whose group may size it. */
const activeRatio = computed(() => props.stacked ? null : linkedRatio.value);
const isLinked = computed(() => activeRatio.value !== null);

function toggleLink() {
	const { width, height } = props.rect;
	linkedRatio.value = linkedRatio.value === null && width > 0 && height > 0 ? width / height : null;
}

function updateSize(axis: 'width' | 'height', value: number | null | undefined) {
	const size = Math.max(1, parseGeometryValue(value ?? 0, containerSpan(SIZE_AXES[axis]), unit.value));
	const ratio = activeRatio.value;
	const sizes = ratio === null
		? { [axis]: size }
		: axis === 'width'
			? { width: size, height: Math.max(1, size / ratio) }
			: { width: Math.max(1, size * ratio), height: size };
	emit('update', resizeGraphicRectFromAnchor(props.rect, sizes, props.anchor));
}

function align(axis: 'x' | 'y', edge: 'start' | 'center' | 'end') {
	emit('update', alignGraphicRect(props.rect, axis, edge, props.container));
}

const inputStep = computed(() => geometryUnitInputStep(unit.value));
</script>

<template>
	<div class="space-y-3">
		<UFormField label="Units" size="sm">
			<GraphicsGeometryUnitPicker v-model="unit" />
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

		<div v-if="!stacked" class="grid grid-cols-2 gap-2">
			<UFormField
				v-for="axis in ['x', 'y'] as const"
				:key="axis"
				:label="axis.toUpperCase()"
				size="sm"
			>
				<UInputNumber
					:model-value="shownPosition(axis)"
					:step="inputStep.step"
					:step-snapping="inputStep.stepSnapping"
					size="sm"
					class="w-full"
					:aria-label="`Item ${axis}`"
					@update:model-value="updatePosition(axis, $event)"
				/>
			</UFormField>
		</div>

		<div class="flex items-end gap-2">
			<template v-for="axis in ['width', 'height'] as const" :key="axis">
				<UButton
					v-if="axis === 'height' && !stacked"
					aria-label="Link width and height"
					:title="isLinked ? 'Unlink width and height' : 'Keep the aspect ratio'"
					:aria-pressed="isLinked"
					:icon="isLinked ? 'i-lucide-link' : 'i-lucide-unlink'"
					size="xs"
					color="neutral"
					:variant="isLinked ? 'solid' : 'ghost'"
					class="mb-0.5 size-7 shrink-0 justify-center p-0"
					@click="toggleLink"
				/>
				<UFormField
					:label="axis === 'width' ? 'Width' : 'Height'"
					size="sm"
					class="min-w-0 flex-1"
				>
					<UInputNumber
						:model-value="shownSize(axis)"
						:step="inputStep.step"
						:step-snapping="inputStep.stepSnapping"
						size="sm"
						class="w-full"
						:aria-label="`Item ${axis}`"
						@update:model-value="updateSize(axis, $event)"
					/>
				</UFormField>
			</template>
		</div>
	</div>
</template>
