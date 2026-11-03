<script setup lang="ts">
import type { GraphicAnchorPoint, GraphicRect } from '~~/shared/types/graphics';
import type { ManipulationHandle, SnapLines } from '~/modules/graphics/canvasManipulation';
import { useElementSize } from '@vueuse/core';
import { graphicAnchorTransformOrigin } from '~~/shared/modules/graphics/geometry';
import {
	canvasSnapLines,
	dragRotation,
	drawnPoint,
	isTurned,
	manipulateRect,
	neighbourGaps,
	RESIZE_HANDLES,
	rotatedBounds,
} from '~/modules/graphics/canvasManipulation';

/**
 * Move, resize and rotate handles for the selected layer, drawn over an editor preview.
 *
 * It sits above the preview frame and takes no pointer events of its own, so
 * clicking anything else still reaches the frame and selects it; only the
 * selection box and its handles catch the pointer. Everything is measured in
 * canvas pixels and scaled to however large the preview is drawn.
 *
 * A drag snaps to the lines it is given, in the layer's container's pixels, and
 * draws the guide it landed on and the gap to the nearest neighbour on each axis.
 * Shift keeps the starting aspect ratio while resizing; Alt turns snapping off.
 *
 * A layer that can turn is drawn turned about its Graphic Anchor Point, as the
 * compositor draws it, with a rotate handle; Shift steps a rotation by 15°. A
 * turned layer resizes along its own axes and snaps only while moving.
 */
const props = defineProps<{
	/** The selected layer's stored rectangle, in its container's pixels; nothing shows without one. */
	rect: GraphicRect | null;
	/** Where the rectangle's container sits on the canvas. */
	origin?: { x: number; y: number };
	canvasWidth: number;
	canvasHeight: number;
	/** What the layer snaps to, in its container's pixels; the canvas's own lines without them. */
	snapLines?: SnapLines;
	label?: string;
	/** The layer's Graphic Rotation in degrees; a layer without one cannot turn. */
	rotation?: number;
	/** The Graphic Anchor Point the layer turns about. */
	anchor?: GraphicAnchorPoint;
}>();

const emit = defineEmits<{
	/** Each frame of a gesture; `gesture` is the same for every frame of one drag. */
	change: [rect: GraphicRect, gesture: number];
	/** Each frame of a rotate drag, as the Graphic Rotation it turns the layer to. */
	rotate: [rotation: number, gesture: number];
}>();

/** The angle a rotate drag steps by while Shift is held. */
const ROTATION_STEP = 15;

const root = ref<HTMLElement | null>(null);
const { width: drawnWidth } = useElementSize(root);
const scale = computed(() => props.canvasWidth > 0
	? drawnWidth.value / props.canvasWidth
	: 0);

const origin = computed(() => props.origin ?? { x: 0, y: 0 });

const snapLines = computed<SnapLines>(() => {
	if (props.snapLines)
		return props.snapLines;
	const lines = canvasSnapLines({ width: props.canvasWidth, height: props.canvasHeight });
	return {
		x: lines.x.map(line => line - origin.value.x),
		y: lines.y.map(line => line - origin.value.y),
	};
});

interface Drag {
	handle: ManipulationHandle | 'rotate';
	pointerId: number;
	startX: number;
	startY: number;
	/** Where the drag started, in the container's pixels. */
	startPoint: { x: number; y: number };
	startRect: GraphicRect;
	startRotation: number;
	gesture: number;
}

let gestureCount = 0;
const drag = shallowRef<Drag | null>(null);
/** What the gesture is drawing, ahead of the round trip through the stored layout. */
const live = shallowRef<{ rect: GraphicRect; rotation: number; snapped: { x?: number; y?: number } } | null>(null);

const shownRect = computed(() => live.value?.rect ?? props.rect);
const shownRotation = computed(() => live.value?.rotation ?? props.rotation ?? 0);

function toCanvas(rect: GraphicRect): GraphicRect {
	return { ...rect, x: rect.x + origin.value.x, y: rect.y + origin.value.y };
}

const boxStyle = computed(() => {
	const rect = shownRect.value;
	if (!rect || scale.value === 0)
		return null;
	const canvasRect = toCanvas(rect);
	return {
		left: `${canvasRect.x * scale.value}px`,
		top: `${canvasRect.y * scale.value}px`,
		width: `${canvasRect.width * scale.value}px`,
		height: `${canvasRect.height * scale.value}px`,
		...(isTurned(shownRotation.value)
			? {
					transform: `rotate(${shownRotation.value}deg)`,
					transformOrigin: graphicAnchorTransformOrigin(props.anchor),
				}
			: {}),
	};
});

/** How far the rotate handle stands off the box, in drawn pixels. */
const ROTATE_HANDLE_OFFSET = 24;

/**
 * Where the rotate handle sits: above the box, or below it where above would be
 * off the canvas and out of reach, or just inside its top edge when neither fits.
 */
const rotateHandlePlacement = computed<'above' | 'below' | 'inside'>(() => {
	const rect = shownRect.value;
	if (!rect || scale.value === 0)
		return 'above';
	const canvasRect = toCanvas(rect);
	const offset = ROTATE_HANDLE_OFFSET / scale.value / Math.max(canvasRect.height, 1);
	const onCanvas = (fraction: number) => {
		const point = drawnPoint(canvasRect, { x: 0.5, y: fraction }, shownRotation.value, props.anchor);
		return point.x >= 0 && point.x <= props.canvasWidth && point.y >= 0 && point.y <= props.canvasHeight;
	};
	if (onCanvas(-offset))
		return 'above';
	return onCanvas(1 + offset)
		? 'below'
		: 'inside';
});

const ROTATE_HANDLE_POSITION = {
	above: '-top-6',
	below: 'top-[calc(100%+1.5rem)]',
	inside: 'top-6',
} as const;

const HANDLE_POSITION: Record<(typeof RESIZE_HANDLES)[number], string> = {
	nw: 'left-0 top-0',
	n: 'left-1/2 top-0',
	ne: 'left-full top-0',
	e: 'left-full top-1/2',
	se: 'left-full top-full',
	s: 'left-1/2 top-full',
	sw: 'left-0 top-full',
	w: 'left-0 top-1/2',
};

/** Each handle's direction from the box's centre, in degrees clockwise from east. */
const HANDLE_ANGLE: Record<(typeof RESIZE_HANDLES)[number], number> = {
	e: 0,
	se: 45,
	s: 90,
	sw: 135,
	w: 180,
	nw: 225,
	n: 270,
	ne: 315,
};
const RESIZE_CURSORS = [
	'cursor-ew-resize',
	'cursor-nwse-resize',
	'cursor-ns-resize',
	'cursor-nesw-resize',
] as const;

/** The resize cursor nearest the direction a handle faces once the box is turned. */
function handleCursor(handle: (typeof RESIZE_HANDLES)[number]): string {
	const octant = Math.round((HANDLE_ANGLE[handle] + shownRotation.value) / 45);
	return RESIZE_CURSORS[((octant % 4) + 4) % 4]!;
}

function start(event: PointerEvent, handle: ManipulationHandle | 'rotate') {
	if (!props.rect || event.button !== 0)
		return;
	event.preventDefault();
	(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
	gestureCount += 1;
	const bounds = root.value?.getBoundingClientRect();
	const drawnScale = scale.value || 1;
	drag.value = {
		handle,
		pointerId: event.pointerId,
		startX: event.clientX,
		startY: event.clientY,
		startPoint: {
			x: (event.clientX - (bounds?.left ?? 0)) / drawnScale - origin.value.x,
			y: (event.clientY - (bounds?.top ?? 0)) / drawnScale - origin.value.y,
		},
		startRect: { ...props.rect },
		startRotation: props.rotation ?? 0,
		gesture: gestureCount,
	};
}

function turnTo(current: Drag, delta: { x: number; y: number }, event: PointerEvent) {
	const rotation = dragRotation(
		{ rect: current.startRect, rotation: current.startRotation, anchor: props.anchor },
		current.startPoint,
		{ x: current.startPoint.x + delta.x, y: current.startPoint.y + delta.y },
		{
			step: event.shiftKey
				? ROTATION_STEP
				: undefined,
		},
	);
	const previous = live.value?.rotation ?? current.startRotation;
	live.value = { rect: current.startRect, rotation, snapped: {} };
	if (rotation !== previous)
		emit('rotate', rotation, current.gesture);
}

function moveTo(event: PointerEvent) {
	const current = drag.value;
	if (!current || event.pointerId !== current.pointerId || scale.value === 0)
		return;
	const delta = {
		x: (event.clientX - current.startX) / scale.value,
		y: (event.clientY - current.startY) / scale.value,
	};
	if (current.handle === 'rotate') {
		turnTo(current, delta, event);
		return;
	}
	const result = manipulateRect(current.startRect, current.handle, delta, {
		keepRatio: event.shiftKey,
		snap: event.altKey
			? undefined
			: {
					lines: snapLines.value,
					threshold: 6 / scale.value,
				},
		rotation: current.startRotation,
		anchor: props.anchor,
	});
	const rect = result.rect;
	const previous = live.value?.rect ?? current.startRect;
	live.value = { rect, rotation: current.startRotation, snapped: result.snapped };
	if (rect.x !== previous.x || rect.y !== previous.y || rect.width !== previous.width || rect.height !== previous.height)
		emit('change', rect, current.gesture);
}

function end(event: PointerEvent) {
	if (drag.value?.pointerId !== event.pointerId)
		return;
	drag.value = null;
	live.value = null;
}

/** The guides and gaps a drag draws, in drawn pixels. */
const guides = computed(() => {
	const current = live.value;
	if (!current || scale.value === 0)
		return null;
	const { x, y } = origin.value;
	const gaps = neighbourGaps(rotatedBounds(current.rect, current.rotation, props.anchor), snapLines.value.neighbours ?? []);
	return {
		x: current.snapped.x === undefined
			? undefined
			: (current.snapped.x + x) * scale.value,
		y: current.snapped.y === undefined
			? undefined
			: (current.snapped.y + y) * scale.value,
		gaps: (['x', 'y'] as const).flatMap((axis) => {
			const gap = gaps[axis];
			if (!gap)
				return [];
			const [along, across, length] = axis === 'x'
				? ['left', 'top', 'width'] as const
				: ['top', 'left', 'height'] as const;
			const start = axis === 'x'
				? x
				: y;
			const cross = axis === 'x'
				? y
				: x;
			return [
				{
					axis,
					size: Math.round(gap.to - gap.from),
					style: {
						[along]: `${(gap.from + start) * scale.value}px`,
						[across]: `${(gap.at + cross) * scale.value}px`,
						[length]: `${(gap.to - gap.from) * scale.value}px`,
					},
				},
			];
		}),
	};
});

const readout = computed(() => {
	const current = live.value;
	if (!current)
		return null;
	const { rect } = current;
	if (drag.value?.handle === 'rotate')
		return `${current.rotation}°`;
	return drag.value?.handle === 'move'
		? `${rect.x}, ${rect.y}`
		: `${rect.width} × ${rect.height}`;
});
</script>

<template>
	<div ref="root" class="pointer-events-none absolute inset-0 overflow-hidden" data-testid="canvas-manipulation-overlay">
		<template v-if="guides">
			<div
				v-if="guides.x !== undefined"
				class="absolute inset-y-0 w-px bg-pink-500"
				:style="{ left: `${guides.x}px` }"
				data-testid="canvas-manipulation-guide"
				data-axis="x"
			/>
			<div
				v-if="guides.y !== undefined"
				class="absolute inset-x-0 h-px bg-pink-500"
				:style="{ top: `${guides.y}px` }"
				data-testid="canvas-manipulation-guide"
				data-axis="y"
			/>
			<div
				v-for="gap in guides.gaps"
				:key="gap.axis"
				class="absolute flex items-center justify-center bg-pink-500"
				:class="gap.axis === 'x' ? 'h-px' : 'w-px'"
				:style="gap.style"
				data-testid="canvas-manipulation-gap"
				:data-axis="gap.axis"
			>
				<span class="whitespace-nowrap rounded bg-pink-500 px-1 font-mono text-[0.6875rem] text-white">{{ gap.size }}</span>
			</div>
		</template>

		<div
			v-if="boxStyle"
			class="pointer-events-auto absolute cursor-move outline-2 outline-primary"
			:style="boxStyle"
			:aria-label="label ? `Move ${label}` : 'Move selection'"
			data-testid="canvas-manipulation-box"
			@pointerdown="start($event, 'move')"
			@pointermove="moveTo"
			@pointerup="end"
			@pointercancel="end"
		>
			<span
				v-for="handle in RESIZE_HANDLES"
				:key="handle"
				class="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-primary bg-white"
				:class="[HANDLE_POSITION[handle], handleCursor(handle)]"
				:data-handle="handle"
				@pointerdown.stop="start($event, handle)"
				@pointermove="moveTo"
				@pointerup="end"
				@pointercancel="end"
			/>
			<span
				v-if="rotation !== undefined"
				class="absolute left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 cursor-grab rounded-full border border-primary bg-white active:cursor-grabbing"
				:class="ROTATE_HANDLE_POSITION[rotateHandlePlacement]"
				:aria-label="label ? `Rotate ${label}` : 'Rotate selection'"
				data-handle="rotate"
				:data-placement="rotateHandlePlacement"
				@pointerdown.stop="start($event, 'rotate')"
				@pointermove="moveTo"
				@pointerup="end"
				@pointercancel="end"
			/>
			<span
				v-if="readout"
				class="absolute left-0 top-full mt-1 origin-top-left whitespace-nowrap rounded bg-inverted px-1.5 py-0.5 font-mono text-[0.6875rem] text-inverted"
				:style="isTurned(shownRotation) ? { transform: `rotate(${-shownRotation}deg)` } : undefined"
			>{{ readout }}</span>
		</div>
	</div>
</template>
